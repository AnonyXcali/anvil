export const getDockerBuildCommands = (
  baseDir: string,
  imageName: string,
  containerName: string,
  port: number,
) => ({
  createDockerfile: `cat > "${baseDir}/Dockerfile" <<'EOF'
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

RUN npm install -g serve

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "3000"]
EOF`,

  verifyFiles: `ls -la "${baseDir}" && ls -la "${baseDir}/src" && test -f "${baseDir}/Dockerfile" && test -f "${baseDir}/package.json"`,

  dockerBuildImage: `docker build -t "${imageName}" "${baseDir}"`,

  removeOldContainer: `docker rm -f "${containerName}" || true`,

  // TODO(security): Avoid binding preview containers on all public interfaces.
  // Bind to localhost/internal networking and expose them only through an auth/TLS proxy.
  runPreviewContainer: `docker run -d --name "${containerName}" -p ${port}:3000 "${imageName}"`,
});
