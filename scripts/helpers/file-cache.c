// macOS file-cache test helper: copy into an O_EXCL file and inspect pages.
// It never purges global caches or changes source bytes. Inspect does not fault
// mapped pages in. A nonzero resident count is evidence against a cold-file claim.
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
#include <time.h>

#if !defined(__APPLE__) || !defined(F_NOCACHE_EXT)
#error "This test helper requires macOS and an SDK defining F_NOCACHE_EXT"
#endif

static void fail(const char *what) { perror(what); exit(1); }
static void reject(const char *what) { fprintf(stderr, "%s\n", what); exit(1); }
static double now_ms(void) {
    struct timespec value;
    if (clock_gettime(CLOCK_MONOTONIC, &value)) fail("clock_gettime");
    return value.tv_sec * 1000.0 + value.tv_nsec / 1000000.0;
}
static size_t page_size(void) {
    long size = sysconf(_SC_PAGESIZE);
    if (size <= 0) reject("invalid page size");
    return (size_t)size;
}
static struct stat file_stat(int fd) {
    struct stat value;
    if (fstat(fd, &value)) fail("fstat");
    if (!S_ISREG(value.st_mode) || value.st_size <= 0 || (uintmax_t)value.st_size > SIZE_MAX)
        reject("expected a nonempty regular file fitting size_t");
    return value;
}
static void residency(int fd, const char *phase) {
    struct stat info = file_stat(fd);
    size_t length = (size_t)info.st_size, page = page_size();
    size_t pages = length / page + !!(length % page);
    void *mapping = mmap(NULL, length, PROT_READ, MAP_SHARED, fd, 0);
    if (mapping == MAP_FAILED) fail("mmap");
    char *vector = calloc(pages, 1); if (!vector) fail("calloc");
    if (mincore(mapping, length, vector)) fail("mincore");
    size_t resident = 0;
    for (size_t i = 0; i < pages; i++) resident += !!(vector[i] & MINCORE_INCORE);
    printf("{\"phase\":\"%s\",\"bytes\":%zu,\"pages\":%zu,\"residentPages\":%zu,\"pageBytes\":%zu,\"monotonicMs\":%.6f}\n",
        phase, length, pages, resident, page, now_ms());
    free(vector);
    if (munmap(mapping, length)) fail("munmap");
}
static int open_source(const char *name) {
    int fd = open(name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    if (fd < 0) fail("open source");
    (void)file_stat(fd);
    return fd;
}
static void read_exact(int fd, void *buffer, size_t length, off_t offset) {
    size_t done = 0;
    while (done < length) {
        ssize_t got = pread(fd, (char *)buffer + done, length - done, offset + (off_t)done);
        if (got < 0 && errno == EINTR) continue;
        if (got < 0) fail("pread");
        if (!got) reject("source ended before its recorded size");
        done += (size_t)got;
    }
}
static void write_exact(int fd, const void *buffer, size_t length) {
    size_t done = 0;
    while (done < length) {
        ssize_t wrote = write(fd, (const char *)buffer + done, length - done);
        if (wrote < 0 && errno == EINTR) continue;
        if (wrote < 0) fail("write");
        if (!wrote) reject("zero-length write");
        done += (size_t)wrote;
    }
}
int main(int argc, char **argv) {
    if (argc < 3 || (strcmp(argv[1], "copy") == 0 ? argc != 4 : argc != 3)) return 2;
    if (strcmp(argv[1], "copy") && strcmp(argv[1], "inspect") && strcmp(argv[1], "warm")) return 2;
    int src = open_source(argv[2]);
    if (!strcmp(argv[1], "inspect")) {
        residency(src, "inspect_without_read");
        if (close(src)) fail("close inspect");
        return 0;
    }
    struct stat before = file_stat(src);
    const size_t page = page_size(), chunk = page * 64;
    void *buffer = NULL;
    int rc = posix_memalign(&buffer, page, chunk);
    if (rc) { errno = rc; fail("posix_memalign"); }
    double started = now_ms();
    int dst = -1;
    if (!strcmp(argv[1], "copy")) {
        dst = open(argv[3], O_CREAT | O_EXCL | O_RDWR | O_NOFOLLOW, 0600);
        if (dst < 0) fail("open new destination");
        if (fcntl(dst, F_NOCACHE_EXT, 1) < 0) fail("F_NOCACHE_EXT destination");
    }
    size_t length = (size_t)before.st_size;
    for (size_t offset = 0; offset < length;) {
        size_t amount = length - offset < chunk ? length - offset : chunk;
        read_exact(src, buffer, amount, (off_t)offset);
        if (dst >= 0) {
            write_exact(dst, buffer, amount);
        }
        offset += amount;
    }
    struct stat after = file_stat(src);
    if (before.st_size != after.st_size || before.st_mtimespec.tv_sec != after.st_mtimespec.tv_sec ||
        before.st_mtimespec.tv_nsec != after.st_mtimespec.tv_nsec || before.st_ctimespec.tv_sec != after.st_ctimespec.tv_sec ||
        before.st_ctimespec.tv_nsec != after.st_ctimespec.tv_nsec) reject("source changed during operation");
    if (dst >= 0) {
        if (fsync(dst)) fail("fsync destination");
        if (close(dst)) fail("close destination");
        dst = open_source(argv[3]);
        printf("{\"phase\":\"copy_complete\",\"bytes\":%zu,\"elapsedMs\":%.6f,\"method\":\"F_NOCACHE_EXT\"}\n",
            length, now_ms() - started);
        residency(dst, "after_uncached_copy");
        if (close(dst)) fail("close inspection");
    } else residency(src, "after_cached_read");
    if (close(src)) fail("close source");
    free(buffer);
    return 0;
}
