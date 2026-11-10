// Run with Electron from the project root; this never loads the main application.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '..');
const Hadith = require(path.join(root, 'src/engines/hadith-engine'));
const { renderHadithImage } = require(path.join(root, 'src/engines/hadith-image'));
const args = process.argv.slice(2),
  read = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? null : args[i + 1];
  };
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    const output = read('--output');
    if (!output) throw Error('حدد مسار PNG باستخدام --output.');
    if (path.extname(output).toLowerCase() !== '.png')
      throw Error('يجب أن ينتهي اسم الصورة بامتداد .png');
    const dataDir = path.resolve(read('--data-dir') || path.join(root, 'data'));
    const storage = {
      dataDir,
      hadithCachePath: path.join(dataDir, 'hadith-cache.json'),
      readJsonSafe: (file, fallback) =>
        fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback,
      writeJsonSafe: () => {
        throw Error('سكريبت الصور لا يعدّل قاعدة الأحاديث.');
      },
    };
    const engine = new Hadith(storage, root),
      hadith = engine.getExportHadith(read('--key'));
    const png = await renderHadithImage({ BrowserWindow, hadith, baseDir: root });
    await fs.promises.writeFile(path.resolve(output), png);
    console.log(path.resolve(output));
    app.exit(0);
  } catch (error) {
    console.error(error.message);
    app.exit(1);
  }
});
