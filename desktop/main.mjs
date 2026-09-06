import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { copyFile, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startServer } from '../server/app.mjs';
import { validateProject } from '../shared/timeline.mjs';
import { atomicReplace } from '../server/atomic-file.mjs';

let server, mainWindow;
app.whenReady().then(async () => {
server = await startServer({ port: 0, dataDir: process.env.HYPERCUT_DATA_DIR || path.join(app.getPath('userData'), 'media') });
function assertSender(event) {
  if (event.senderFrame !== event.sender.mainFrame || new URL(event.senderFrame.url).origin !== server.url) throw new Error('허용하지 않은 앱 요청입니다.');
}
async function protectSource(target) {
  const realTarget = await realpath(target).catch(() => target);
  for (const media of server.media.values()) if (await realpath(media.path) === realTarget) throw new Error('원본 영상과 다른 이름으로 저장해 주세요.');
  for (const asset of server.effectAssets.values()) if (await realpath(asset.path).catch(() => asset.path) === realTarget) throw new Error('효과음 원본과 다른 이름으로 저장해 주세요.');
}
ipcMain.handle('hypercut:save-project', async (event, data) => {
  assertSender(event);
  if (JSON.stringify(data).length > 10 * 1024 ** 2) throw new Error('프로젝트 파일이 너무 큽니다.');
  const project = validateProject(data);
  const chosen = await dialog.showSaveDialog(mainWindow, { title: 'HyperCut 프로젝트 저장', defaultPath: path.parse(project.media.name).name + '.hypercut.json', filters: [{ name: 'HyperCut 프로젝트', extensions: ['json'] }] });
  if (chosen.canceled || !chosen.filePath) return false;
  const target = path.resolve(chosen.filePath); await protectSource(target);
  await atomicReplace(target, temporary => writeFile(temporary, JSON.stringify(project, null, 2), { flag: 'wx' }));
  return true;
});
ipcMain.handle('hypercut:pick-video', async event => {
  assertSender(event);
  const chosen = await dialog.showOpenDialog(mainWindow, { title: '편집할 영상 선택', properties: ['openFile'], filters: [{ name: 'H.264 영상', extensions: ['mp4', 'mov'] }] });
  if (chosen.canceled || !chosen.filePaths[0]) return null;
  return server.registerFile(chosen.filePaths[0]);
});
ipcMain.handle('hypercut:pick-effect', async event => {
  assertSender(event);
  const chosen = await dialog.showOpenDialog(mainWindow, { title: '효과음 선택', properties: ['openFile'], filters: [{ name: '오디오', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg'] }] });
  if (chosen.canceled || !chosen.filePaths[0]) return null;
  return server.registerEffect(chosen.filePaths[0]);
});
ipcMain.handle('hypercut:save-export', async (event, id) => {
  assertSender(event);
  const output = typeof id === 'string' && server.exports.get(id);
  if (!output) throw new Error('저장할 결과물을 찾을 수 없습니다.');
  const subtitle = output.mime === 'application/x-subrip', text = output.mime === 'text/plain; charset=utf-8';
  const chosen = await dialog.showSaveDialog(mainWindow, { title: text ? '대본 TXT 저장' : subtitle ? '편집한 자막 저장' : '편집한 영상 저장', defaultPath: output.name, filters: [{ name: text ? 'TXT 대본' : subtitle ? 'SRT 자막' : 'MP4 영상', extensions: [text ? 'txt' : subtitle ? 'srt' : 'mp4'] }] });
  if (chosen.canceled || !chosen.filePath) return false;
  const target = path.resolve(chosen.filePath);
  await protectSource(target);
  await atomicReplace(target, temporary => copyFile(output.path, temporary, constants.COPYFILE_EXCL));
  return true;
});
ipcMain.handle('hypercut:open-browser', async event => { assertSender(event); await shell.openExternal(server.url); });

mainWindow = new BrowserWindow({
  title: 'HyperCut', width: 1440, height: 940, minWidth: 860, minHeight: 700, backgroundColor: '#101210',
  webPreferences: { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true }
});
mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
mainWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== server.url) event.preventDefault(); });
mainWindow.webContents.on('will-prevent-unload', event => {
  const choice = dialog.showMessageBoxSync(mainWindow, { type: 'question', buttons: ['계속 편집', '저장하지 않고 닫기'], defaultId: 0, cancelId: 0, message: '저장하지 않은 편집이나 진행 중인 작업이 있습니다.', detail: '프로젝트를 저장하면 나중에 편집을 이어갈 수 있습니다.' });
  if (choice === 1) event.preventDefault();
});
await mainWindow.loadURL(server.url);
if (process.env.HYPERCUT_SMOKE) console.log(`HYPERCUT_DESKTOP_READY ${server.url}`);
app.on('window-all-closed', () => app.quit());
let shuttingDown = false;
app.on('will-quit', event => {
  if (shuttingDown) return;
  event.preventDefault(); shuttingDown = true;
  void server.close().finally(() => app.exit(0));
});
}).catch(error => { console.error(error); app.quit(); });
