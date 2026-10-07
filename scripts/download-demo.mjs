import { mkdir, writeFile } from 'node:fs/promises';

const photos = [
  ['01-湖山之间.jpg', 'photo-1470770841072-f978cf4d019e'],
  ['02-远山来信.jpg', 'photo-1464822759023-fed622ff2c3b'],
  ['03-森林慢行.jpg', 'photo-1441974231531-c6227db76b6e'],
  ['04-湖畔日光.jpg', 'photo-1476514525535-07fb3b4ae5f1'],
  ['05-星夜雪山.jpg', 'photo-1519681393784-d120267933ba'],
  ['06-旷野旅途.jpg', 'photo-1500534314209-a25ddb2bd429'],
];
await mkdir('resources/demo', { recursive: true });
for (const [name, photo] of photos) {
  const url = `https://images.unsplash.com/${photo}?w=1600&q=86&fit=crop`;
  const response = await fetch(url); if (!response.ok) throw new Error(`${name}: ${response.status}`);
  await writeFile(`resources/demo/${name}`, Buffer.from(await response.arrayBuffer()));
  console.log(`Saved ${name}`);
}
await writeFile('resources/demo/CREDITS.md', '# 示例照片\n\n示例照片来自 Unsplash，仅用于演示；软件运行时全部从本地读取。\n\n许可：https://unsplash.com/license\n\n' + photos.map(([name, photo]) => `- ${name}: https://images.unsplash.com/${photo}`).join('\n') + '\n');
