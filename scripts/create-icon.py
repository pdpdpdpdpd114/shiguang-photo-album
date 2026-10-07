from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / 'resources'
root.mkdir(exist_ok=True)
image = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((8, 8, 504, 504), radius=108, fill='#17231e')
draw.rounded_rectangle((30, 30, 482, 482), radius=89, outline='#809376', width=2)
for x, y, color in [(101, 101, '#c4ddaf'), (274, 101, '#8ba17b'), (101, 274, '#9eb990'), (274, 274, '#d8e7c7')]:
    draw.rounded_rectangle((x, y, x+137, y+137), radius=27, fill=color)
image.save(root / 'icon.png')
image.save(root / 'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('Created Windows album icon')
