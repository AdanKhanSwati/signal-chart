#!/usr/bin/env python3
"""Repack the actual user-approved orange two-bar PNG for Android and PWAs.
Source artwork is never redrawn, recolored, or replaced with the legacy logo.
"""
from pathlib import Path
import base64
from PIL import Image
from io import BytesIO

ROOT=Path(__file__).resolve().parent.parent
ORIGINAL=ROOT/"brand"/"approved-signalchart-two-bars.png"
icon=Image.open(ORIGINAL).convert("RGBA")
if icon.size!=(192,192):
    raise SystemExit("Approved icon source must be 192 x 192")
# Preserve the exact crop and gradient; generate platform-specific resolutions.
def put(im,rel):
    dest=ROOT/rel
    dest.parent.mkdir(parents=True,exist_ok=True)
    buf=BytesIO()
    im.save(buf,format="PNG",optimize=True)
    if not dest.exists() or dest.read_bytes()!=buf.getvalue():
        dest.write_bytes(buf.getvalue())
    print(rel,dest.stat().st_size)
put(icon,"ops-icon-192.png")
put(icon,"mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png")
large=icon.resize((512,512),Image.Resampling.LANCZOS)
put(large,"ops-icon-512.png")
put(large,"mobile/android/app/src/main/res/drawable/brand_icon.png")
# The native mark and notification/favicons use the same approved PNG pixels.
embedded=base64.b64encode(ORIGINAL.read_bytes()).decode("ascii")
svg=('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"
 role="img" aria-label="SignalChart approved two-bar mark"><image width="192"
 height="192" href="data:image/png;base64,'''+embedded+'''"/></svg>''')
for rel in ("signalchart-mark.svg","ops-icon.svg"):
    (ROOT/rel).write_text(svg,encoding="utf-8")
    print(rel,len(svg))
