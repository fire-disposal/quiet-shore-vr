import { QuietShoreApp } from './app/App';

declare global {
  interface Window {
    __app?: QuietShoreApp;
  }
}

try {
  const app = new QuietShoreApp();
  window.__app = app;
  app.run();
} catch (error) {
  console.error(error);
  const status = document.getElementById('status');
  if (status) {
    status.textContent = `启动失败：${error instanceof Error ? error.message : String(error)}`;
    status.dataset.tone = 'error';
  }
}
