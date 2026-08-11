export function isProjectRelativePath(filePath: string): boolean {
  return (
    filePath.trim().length > 0 &&
    !filePath.startsWith('/') &&
    !/^[A-Za-z]:[\\/]/.test(filePath) &&
    !filePath.split(/[\\/]/).includes('..')
  );
}
