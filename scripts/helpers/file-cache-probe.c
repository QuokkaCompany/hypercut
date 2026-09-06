#include <sys/types.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <errno.h>
#include <string.h>

static void fail(const char *what) { perror(what); exit(1); }
static void residency(int fd, size_t length, const char *phase) {
    size_t page = (size_t)sysconf(_SC_PAGESIZE), pages = (length + page - 1) / page;
    void *mapping = mmap(NULL, length, PROT_READ, MAP_SHARED, fd, 0);
    if (mapping == MAP_FAILED) fail("mmap");
    char *vector = calloc(pages, 1); if (!vector) fail("calloc");
    if (mincore(mapping, length, vector) != 0) fail("mincore");
    size_t resident = 0;
    for (size_t i = 0; i < pages; i++) resident += !!(vector[i] & MINCORE_INCORE);
    printf("{\"phase\":\"%s\",\"pages\":%zu,\"residentPages\":%zu,\"pageBytes\":%zu}\n", phase, pages, resident, page);
    free(vector); if (munmap(mapping, length) != 0) fail("munmap");
}
int main(int argc, char **argv) {
    if (argc != 2) return 2;
    const size_t chunk = 1024 * 1024, length = 32 * chunk;
    void *buffer; int rc = posix_memalign(&buffer, (size_t)sysconf(_SC_PAGESIZE), chunk);
    if (rc) { errno = rc; fail("posix_memalign"); }
    for (size_t i = 0; i < chunk; i++) ((unsigned char *)buffer)[i] = (i * 17 + i / 256) % 251;
    int fd = open(argv[1], O_CREAT | O_EXCL | O_RDWR, 0600); if (fd < 0) fail("open new file");
    if (fcntl(fd, F_NOCACHE, 1) < 0) fail("F_NOCACHE");
    for (size_t n = 0; n < length; n += chunk) {
        ssize_t wrote = write(fd, buffer, chunk); if (wrote != (ssize_t)chunk) fail("aligned write");
    }
    if (fsync(fd)) fail("fsync");
    if (close(fd)) fail("close write");
    fd = open(argv[1], O_RDONLY); if (fd < 0) fail("open read");
    residency(fd, length, "after_uncached_write");
    residency(fd, length, "repeat_without_read");
    for (size_t n = 0; n < length; n += chunk) {
        ssize_t got = pread(fd, buffer, chunk, n); if (got != (ssize_t)chunk) fail("cached pread");
        for (size_t i = 0; i < chunk; i++) if (((unsigned char *)buffer)[i] != (i * 17 + i / 256) % 251) { fprintf(stderr,"data mismatch\n"); return 1; }
    }
    residency(fd, length, "after_cached_read");
    if (close(fd)) fail("close read"); free(buffer); return 0;
}
