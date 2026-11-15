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
- **AI Portrait:** on-device person segmentation (MediaPipe). It can blur, dim, recolor or replace the background, or cut you out, live on video and in exports. A "Light on you" slider brightens just the person. Cut-out photos save as transparent PNGs.
- **AI Upscale & Restore:** the Swin2SR 4× model rebuilds detail and removes noise and JPEG blockiness on photos. It uses the GPU (WebGPU) when the phone has one.
- **Search (🔍 on every screen, Ctrl+K on desktop):** finds tools by what you mean ("slow motion" → Speed, "blur background" → AI), filters and transitions (tap to apply), music, files, projects and settings.
- **Search, pick, make a video:** search for a thing ("dog", "red car", "DJ") or a person plus a thing ("Me DJing"), tap results to pick them in order, then make a video or add them to the one you're editing. In videos, search finds the best moment ("at 1:24") and adds about 6 seconds around it.
- **AI search (opt-in):** MobileCLIP finds photos and videos by what's in them ("DJ playing music", "cowboy hat"). Face recognition (face-api) groups photos into people you can name and search. Scanning happens on the phone.
- **Export by destination:** choose YouTube, Shorts, Reels, an Instagram post or Story, TikTok, or custom. The app suggests the best shape, resolution (up to 4K), frame rate and bitrate, and warns about length limits.
- **Customizable toolbar:** drag tools into any order and hide the ones you don't use. Long-press a tool, or tap Customize.
- **Look:** themes, your own photo, a solid color or a custom gradient for the background. You can also set the accent color, text color, app font, and panel color and transparency, and save the result as your own theme.
- **Library (file manager):** folders, filters by type, multi-select, share, save, move, rename and delete. Exports, voiceovers and saved frames are sorted into their own folders automatically.
- **Share into the app:** once it's installed, S1 Studio shows up in the Android share sheet, so you can share a video from your gallery straight into it.
- **Theme:** 8 background themes, your own photo (with a darkness slider) or a solid color, an accent color, and frosted or solid panels.

Everything is stored on the device in IndexedDB. Nothing is uploaded.

## Security

- **Checked AI downloads:** the AI features load code from cdn.jsdelivr.net. The service worker compares every one of those files with a SHA-256 fingerprint in `trusted-files.js` and blocks any file that isn't on the list or has changed. AI features wait until that check is running. After you change an AI library version, run `node editor/tools/update-trusted.mjs` to rebuild the list.
- **No stale copies:** only checked files are saved for offline use, and the saved AI files are cleared whenever the list changes.
- **Shared files need your OK:** any website can try to send files to the share target, so files shared into the app wait for you to tap **Keep** or **Discard**. A single share holds at most 50 files and 4 GB.
- **Content Security Policy:** `index.html` lists the only sites the app may load scripts, styles, fonts and data from.
- **Not fingerprinted yet:** the AI model data (MediaPipe `.tflite` files and the Hugging Face models). They're data rather than code, but they come from Google and Hugging Face without a fingerprint.

## Files

- `index.html`, `styles.css`: app shell
- `js/app.js`: screens, editor tools, library, settings
- `js/engine.js`: timeline playback, rendering, audio mixing, export
- `js/gl.js`: WebGL filters, adjustments, auto-enhance
- `js/media.js`: importing, thumbnails, save and share
- `js/ai.js`, `js/upscale-worker.js`: AI Portrait and AI Upscale
- `js/search.js`, `js/clip-worker.js`: search, AI content search and people
- `js/db.js`: IndexedDB storage
- `sw.js`, `manifest.webmanifest`: offline support, install, share target and the AI download check
- `trusted-files.js`, `tools/update-trusted.mjs`: fingerprints of allowed outside files, and the script that rebuilds them
- `js/cdn-guard.js`: makes AI features wait until the download check is running

## Known limits

- Export runs in real time: a 60-second video takes about 60 seconds. Keep the screen on while it runs (the app asks the phone to stay awake).
- AI Upscale runs on photos only. Upscaling every video frame needs more power than a phone has. On phones without WebGPU it takes about 20 seconds per 128 px tile.
- AI models download the first time they're used: segmentation is 0.25–16 MB, upscaling about 53 MB, and AI search about 75 MB. After that they're cached for offline use.
- People recognition only looks at your own library. It never searches for people online.
- Music must come from files on your phone. The app doesn't download from YouTube or other streaming sites.
