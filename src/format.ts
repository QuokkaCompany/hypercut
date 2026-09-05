export const formatTime = (seconds: number, precise = false) => {
  const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(value / 60), remainder = Math.floor(value % 60);
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}${precise ? `.${String(Math.floor((value % 1) * 100)).padStart(2, '0')}` : ''}`;
};
export const formatSize = (size: number) => size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(1)} GB` : `${(size / 1024 ** 2).toFixed(1)} MB`;
