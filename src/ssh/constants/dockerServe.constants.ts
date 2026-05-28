export const getDockerServeCommands = (
  workspaceDir: string,
  imageName: string,
  containerName: string,
  port: number,
  sshHost: string | undefined,
) => ({
  createDockerfile: `cat > "${workspaceDir}/Dockerfile" <<'EOF'
FROM node:20-alpine AS runner

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]
EOF`,

  verifyFiles: `ls -la "${workspaceDir}" && ls -la "${workspaceDir}/src" && test -f "${workspaceDir}/Dockerfile" && test -f "${workspaceDir}/package.json"`,

  buildPreviewImage: `docker build -t "${imageName}" "${workspaceDir}"`,

  removeExistingContainer: `docker rm -f "${containerName}" || true`,

  runPreviewContainer: `docker run -d --name "${containerName}" -p ${port}:3000 -v "${workspaceDir}:/app" -v /app/node_modules "${imageName}"`,

  previewUrlLog: `echo "The preview url is at http://${sshHost}:${port}"`,
});
