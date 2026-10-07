"""Create synthetic test pictures; none are included in application downloads."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / '.test-data' / 'format-fixtures'
root.mkdir(parents=True, exist_ok=True)
image = Image.new('RGB', (480, 640), '#182d22')
draw = ImageDraw.Draw(image)
for y in range(640):
    draw.line((0, y, 480, y), fill=(40 + y // 8, 80 + y // 8, 60 + y // 8))
draw.rectangle((30, 30, 180, 100), fill='#efb96d')
draw.text((45, 50), 'TOP - PORTRAIT', fill='#141c17')
for format_name, extension in [('JPEG', 'jpg'), ('PNG', 'png'), ('WEBP', 'webp'), ('GIF', 'gif'), ('BMP', 'bmp'), ('AVIF', 'avif')]:
    image.save(root / f'竖图方向-{extension}.{extension}', format=format_name)
frames = [Image.new('RGB', (480, 640), color) for color in ['#223322', '#885544', '#447788']]
frames[0].save(root / '动态图片.gif', save_all=True, append_images=frames[1:], duration=300, loop=0)
exif = Image.Exif()
exif[274] = 6
image.transpose(Image.Transpose.ROTATE_90).save(root / 'EXIF-旋转竖图.jpg', exif=exif)
(root / '转换失败.heic').write_bytes(b'broken HEIC test')
print(f'Test pictures: {root}')
