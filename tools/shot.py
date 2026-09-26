#!/usr/bin/env python3
"""Screenshot helper for visual QA (headless Chromium, WebGL2 via SwiftShader).

Usage:
  python3 tools/shot.py URL OUT.png [--w 1280] [--h 720] [--wait 1500] [--eval "js expr"] [--click X,Y] [--console]

Prints console errors (always) and all console messages with --console.
Start a dev server first, e.g.:  npx vite --host 127.0.0.1 --port 5301 --strictPort
"""
import argparse, sys
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('url'); ap.add_argument('out')
ap.add_argument('--w', type=int, default=1280); ap.add_argument('--h', type=int, default=720)
ap.add_argument('--wait', type=int, default=1500)
ap.add_argument('--eval', action='append', default=[])
ap.add_argument('--click', default=None)
ap.add_argument('--console', action='store_true')
a = ap.parse_args()

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': a.w, 'height': a.h})
    msgs = []
    pg.on('console', lambda m: msgs.append((m.type, m.text)))
    pg.on('pageerror', lambda e: msgs.append(('pageerror', str(e))))
    pg.goto(a.url, wait_until='load', timeout=60000)
    pg.wait_for_timeout(a.wait)
    for js in a.eval:
        try:
            r = pg.evaluate(js)
            print('eval ->', r)
        except Exception as e:
            print('eval error:', e)
        pg.wait_for_timeout(300)
    if a.click:
        x, y = [int(v) for v in a.click.split(',')]
        pg.mouse.click(x, y); pg.wait_for_timeout(500)
    pg.screenshot(path=a.out)
    for t, m in msgs:
        if a.console or t in ('error', 'pageerror', 'warning'):
            print(f'[{t}] {m}')
    b.close()
print('saved', a.out)
