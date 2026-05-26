export const getScaffoldCommands = (baseDir: string) => ({
  //TODO: change the hello-world to project_name or id
  createWorkspace: `mkdir -p "${baseDir}"`,
  generateViteProject: `cd "${baseDir}" && npm create vite@latest hello-world -- --template react-ts`,
  copyTemplateProject: `cp -r /mnt/preview-data/preview-platform/templates/react-vite-ts/. ${baseDir}`,
  deleteOldCreateNewFolder: `rm -rf "${baseDir}" && mkdir -p "${baseDir}/src"`,

  createPackageJsonFile: `cat > "${baseDir}/package.json" <<'EOF'
{
"scripts": {
  "dev": "vite dev",
  "build": "vite build"
},
"dependencies": {
  "@vitejs/plugin-react": "latest",
  "vite": "latest",
  "typescript": "latest",
  "react": "latest",
  "react-dom": "latest",
  "serve": "latest"
},
"devDependencies": {}
}
EOF`,

  createIndexHtmlFile: `cat > "${baseDir}/index.html" <<'EOF'
<!doctype html>
<html>
<head>
  <title>React Preview</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
EOF`,

  createMainTsxFile: `cat > "${baseDir}/src/main.tsx" <<'EOF'
import React from 'react';
import ReactDOM from 'react-dom/client';
import './style.css';
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
<React.StrictMode>
<App />
</React.StrictMode>
);
EOF`,

  createCssFile: `cat > "${baseDir}/src/style.css" <<'EOF'
body {
margin: 0;
font-family: system-ui, sans-serif;
background: #111827;
color: white;
}

.page {
min-height: 100vh;
display: grid;
place-content: center;
text-align: center;
}
EOF`,
});
