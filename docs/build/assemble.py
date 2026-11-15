head = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ArcQuest architecture and design</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="style.css"></head><body>'''
parts = ''.join(open(f'/home/user/app/docs/build/part{i}.html', encoding='utf-8').read() for i in range(1, 6))
open('/home/user/app/docs/build/index.html', 'w', encoding='utf-8').write(head + parts + '</body></html>')
print('ok', len(head + parts))
