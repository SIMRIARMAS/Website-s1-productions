# S1 Studio

A phone-first video and photo editor that runs in the browser and installs like an app (PWA). It's styled after InShot's layout, with a cleaner interface and a background you can customize.

Open `editor/` on any HTTPS host (GitHub Pages works), then use **Add to Home screen** to install it.

## What it does

- **Video projects:** import clips and photos. You can trim, split, reorder, duplicate and delete them, change speed (0.1×–4×) or a photo's duration, and add transitions (fade, dip, flash, slide, zoom, wipe, spin).
- **Photo projects:** edit a single photo and save it as JPG or PNG at full resolution.
- **Look:** 14 filter presets with a strength slider, plus 11 adjustments (brightness, contrast, saturation, warmth, tint, highlights, shadows, sharpen, vignette, fade, grain). They're GPU-rendered (WebGL), so the preview stays live.
- **✨ Enhance:** reads the frame's histogram and sets exposure, contrast, color and sharpening automatically. You can apply it to one clip or every clip.
- **Canvas:** 9:16, 16:9, 1:1, 4:5, 3:4, 4:3 or original ratio, with fit or fill. The background behind the clip can be blurred, a solid color, a gradient or an image. You can also zoom, reposition, rotate and flip a clip, or add a Ken Burns-style move.
- **Text and stickers:** 8 fonts, colors, and outline, box, shadow or neon styles. Text can animate in (fade, pop, slide, typewriter, pulse). Drag it on the preview to move it; pinch to resize and rotate.
- **Sound:** import songs (or take the sound from any video) and set volume, fades, trim, placement and splits. You can record a voiceover while the video plays, and set each clip's volume or mute it.
- **Export:** 720p, 1080p or 2K at 24, 30 or 60 fps. The file is MP4 where the browser supports it, otherwise WebM. Exports are saved to the Library, and you can **Share** them through the phone's share sheet (Quick Share, Instagram, TikTok, Messages…) or **Save** them to the phone.
- **Library (file manager):** folders, filters by type, multi-select, share, save, move, rename and delete. Exports, voiceovers and saved frames are sorted into their own folders automatically.
- **Share into the app:** once it's installed, S1 Studio shows up in the Android share sheet, so you can share a video from your gallery straight into it.
- **Theme:** 8 background themes, your own photo (with a darkness slider) or a solid color, an accent color, and frosted or solid panels.

Everything is stored on the device in IndexedDB. Nothing is uploaded.

## Files

- `index.html`, `styles.css`: app shell
- `js/app.js`: screens, editor tools, library, settings
- `js/engine.js`: timeline playback, rendering, audio mixing, export
- `js/gl.js`: WebGL filters, adjustments, auto-enhance
- `js/media.js`: importing, thumbnails, save and share
- `js/db.js`: IndexedDB storage
- `sw.js`, `manifest.webmanifest`: offline support, install and share target

## Known limits

- Export runs in real time: a 60-second video takes about 60 seconds. Keep the screen on while it runs (the app asks the phone to stay awake).
- Enhance is an automatic algorithm, not a neural network. AI upscaling and background removal would come next.
- Music must come from files on your phone. The app doesn't download from YouTube or other streaming sites.
