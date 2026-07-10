export const getDockerOperationalCommands = (containerName: string) => ({
  stopPreviewContainer: `docker stop ${containerName}`,
  startPreviewContainer: `docker start ${containerName}`,
  removeExistingContainer: `docker rm -f "${containerName}" || true`,
});
