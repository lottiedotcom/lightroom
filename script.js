const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let originalImage = null;

const MAX_PREVIEW_SIZE = 800; 
let previewWidth = 0;
let previewHeight = 0;

// The expanded Settings Object
let settings = {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    temp: 0, tint: 0, vibrance: 0, saturation: 0,
    
    // HSL 
    redHue: 0, redSat: 0, orangeHue: 0, orangeSat: 0, greenHue: 0, greenSat: 0, 
    blueHue: 0, blueSat: 0, pinkHue: 0, pinkSat: 0,
    
    // Color Grading
    shadowHue: 0, shadowGradSat: 0, highHue: 0, highGradSat: 0,
    
    // Effects
    blur: 0, clarity: 0, sharpen: 0, vignette: 0, grain: 0
};

// --- Mobile Navigation ---
const tabBtns = document.querySelectorAll('.tab-btn');
const toolPanels = document.querySelectorAll('.tool-panel');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(t => t.classList.remove('active'));
        toolPanels.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
    });
});

// --- UI & Interactions ---
const sliders = document.querySelectorAll('input[type="range"]');
function updateUI() {
    sliders.forEach(slider => {
        slider.value = settings[slider.id];
        document.getElementById(`val-${slider.id}`).textContent = settings[slider.id];
    });
    requestAnimationFrame(renderPreview);
}

sliders.forEach(slider => {
    slider.addEventListener('input', (e) => {
        settings[e.target.id] = parseFloat(e.target.value);
        document.getElementById(`val-${e.target.id}`).textContent = e.target.value;
        requestAnimationFrame(renderPreview); 
    });
});

document.getElementById('upload-btn').onclick = () => document.getElementById('file-upload').click();
document.getElementById('load-preset-btn').onclick = () => document.getElementById('load-preset').click();

document.getElementById('file-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        originalImage = new Image();
        originalImage.onload = () => {
            const scale = Math.min(1, MAX_PREVIEW_SIZE / Math.max(originalImage.width, originalImage.height));
            previewWidth = originalImage.width * scale;
            previewHeight = originalImage.height * scale;
            canvas.style.display = 'block';
            document.getElementById('status').style.display = 'none';
            document.getElementById('download-btn').disabled = false;
            renderPreview();
        };
        originalImage.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

// --- Preset Management ---
document.getElementById('copy-preset').onclick = () => { navigator.clipboard.writeText(JSON.stringify(settings)); alert('Preset copied! ✨'); };
document.getElementById('paste-preset').onclick = async () => { try { const text = await navigator.clipboard.readText(); settings = { ...settings, ...JSON.parse(text) }; updateUI(); } catch (e) { alert('Could not paste preset.'); }};
document.getElementById('save-preset').onclick = () => { const a = document.createElement('a'); a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(settings)); a.download = "preset.json"; a.click(); };
document.getElementById('load-preset').addEventListener('change', (e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (event) => { settings = { ...settings, ...JSON.parse(event.target.result) }; updateUI(); }; reader.readAsText(file); });
document.getElementById('reset-btn').onclick = () => { Object.keys(settings).forEach(key => settings[key] = 0); updateUI(); };

// --- Math Helpers ---
// Convert RGB to HSL and back for targeted color manipulation
function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; } 
    else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h * 360, s, l];
}
function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; } 
    else {
        function hue2rgb(p, q, t) {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        }
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        let p = 2 * l - q;
        h /= 360;
        r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3);
    }
    return [r * 255, g * 255, b * 255];
}

// Convert Color Grading Hue/Sat to additive RGB values
function getGradingColor(hue, sat, luminanceWeight) {
    if (sat === 0) return [0, 0, 0];
    const rgb = hslToRgb(hue, sat / 100, 0.5); // Midtone strength color
    // Scale by strength based on user setting
    return [
        (rgb[0] - 128) * luminanceWeight,
        (rgb[1] - 128) * luminanceWeight,
        (rgb[2] - 128) * luminanceWeight
    ];
}

// --- The Core Math Engine ---
function processPixels(data, width, height) {
    const factor = (259 * (settings.contrast + 255)) / (255 * (259 - settings.contrast));
    const cx = width / 2;
    const cy = height / 2;
    const maxDist = Math.sqrt(cx*cx + cy*cy);

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i + 1], b = data[i + 2];
        let x = (i / 4) % width;
        let y = Math.floor((i / 4) / width);

        // 1. Light & Exposure
        let exp = 1 + (settings.exposure / 100);
        r *= exp; g *= exp; b *= exp;

        // 2. Global Temp & Tint
        r += settings.temp * 0.5; b -= settings.temp * 0.5;
        g += settings.tint * 0.5;

        // 3. Targeted HSL
        let [h, s, l] = rgbToHsl(r, g, b);
        let sMod = 0, hMod = 0;
        
        // Check ranges and blend smoothly
        if (h > 330 || h <= 15) { hMod += settings.redHue; sMod += settings.redSat; } // Red
        else if (h > 15 && h <= 45) { hMod += settings.orangeHue; sMod += settings.orangeSat; } // Orange
        else if (h > 75 && h <= 150) { hMod += settings.greenHue; sMod += settings.greenSat; } // Green
        else if (h > 200 && h <= 260) { hMod += settings.blueHue; sMod += settings.blueSat; } // Blue
        else if (h > 260 && h <= 330) { hMod += settings.pinkHue; sMod += settings.pinkSat; } // Pink/Plum

        if (hMod !== 0 || sMod !== 0) {
            h = (h + hMod + 360) % 360; // Keep hue in 0-360 range
            s = Math.max(0, Math.min(1, s + (sMod / 100)));
            [r, g, b] = hslToRgb(h, s, l);
        }

        // 4. Color Grading (Split Toning)
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        if (settings.shadowGradSat > 0 && luminance < 128) {
            let weight = (128 - luminance) / 128; // Stronger in darker pixels
            let [cR, cG, cB] = getGradingColor(settings.shadowHue, settings.shadowGradSat, weight);
            r += cR; g += cG; b += cB;
        }
        if (settings.highGradSat > 0 && luminance >= 128) {
            let weight = (luminance - 128) / 128; // Stronger in lighter pixels
            let [cR, cG, cB] = getGradingColor(settings.highHue, settings.highGradSat, weight);
            r += cR; g += cG; b += cB;
        }

        // 5. Highs, Shadows, Whites, Blacks
        if (luminance > 128) {
            let highMod = (luminance - 128) / 128;
            r += settings.highlights * highMod; g += settings.highlights * highMod; b += settings.highlights * highMod;
        } else {
            let shadMod = (128 - luminance) / 128;
            r += settings.shadows * shadMod; g += settings.shadows * shadMod; b += settings.shadows * shadMod;
        }
        r += settings.whites; g += settings.whites; b += settings.whites;
        r -= settings.blacks; g -= settings.blacks; b -= settings.blacks;

        // 6. Upgraded Clarity (Midtone Texture Smoother)
        if (settings.clarity !== 0) {
            let clarFactor = settings.clarity / 100;
            // Weights clarity highest at exactly 128 luminance, tapering off to 0 at pitch black/pure white
            let midtoneWeight = 1 - (Math.abs(luminance - 128) / 128); 
            
            // By shifting color towards its own luminance value, we either smooth the texture (-) or grit it up (+)
            r += (r - luminance) * clarFactor * midtoneWeight; 
            g += (g - luminance) * clarFactor * midtoneWeight; 
            b += (b - luminance) * clarFactor * midtoneWeight;
        }

        // 7. Global Saturation & Vibrance
        let maxRGB = Math.max(r, g, b);
        let avgRGB = (r + g + b) / 3;
        let totalSat = (settings.saturation / 100) + ((settings.vibrance / 100) * (1 - (maxRGB - avgRGB) / 255));
        r += (r - avgRGB) * totalSat; g += (g - avgRGB) * totalSat; b += (b - avgRGB) * totalSat;

        // 8. Contrast
        r = factor * (r - 128) + 128; g = factor * (g - 128) + 128; b = factor * (b - 128) + 128;

        // 9. Vignette (Darken edges)
        if (settings.vignette !== 0) {
            let dist = Math.sqrt((x-cx)*(x-cx) + (y-cy)*(y-cy));
            let vigAmt = (settings.vignette / 100); 
            // Negative vignette darkens, positive lightens
            let vigMod = 1 + (vigAmt * Math.pow(dist / maxDist, 2)); 
            r *= vigMod; g *= vigMod; b *= vigMod;
        }

        // 10. Grain
        if (settings.grain > 0) {
            let noise = (Math.random() - 0.5) * settings.grain;
            r += noise; g += noise; b += noise;
        }

        data[i] = Math.min(255, Math.max(0, r));
        data[i + 1] = Math.min(255, Math.max(0, g));
        data[i + 2] = Math.min(255, Math.max(0, b));
    }
}

// Lightweight Edge Sharpen (Convolution Matrix applied after pixel process)
function applySharpen(ctx, w, h, amount) {
    if (amount <= 0) return;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const mix = amount / 200; // Keep subtle
    const w4 = w * 4;
    
    // Create a copy to read from while writing to original
    const copy = new Uint8ClampedArray(data);
    
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let i = (y * w + x) * 4;
            for (let c = 0; c < 3; c++) { // R, G, B channels
                let ic = i + c;
                // Matrix: Center * 5, minus top/bottom/left/right
                let val = (copy[ic] * 5)
                        - copy[ic - 4] 
                        - copy[ic + 4]
                        - copy[ic - w4]
                        - copy[ic + w4];
                data[ic] = copy[ic] + (val - copy[ic]) * mix;
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

// --- Render Pipelines ---
function renderPreview() {
    if (!originalImage) return;

    canvas.width = previewWidth; canvas.height = previewHeight;

    // 1. Base draw
    ctx.drawImage(originalImage, 0, 0, previewWidth, previewHeight);

    // 2. Soft-focus skin blur
    if (settings.blur > 0) {
        ctx.globalAlpha = settings.blur / 250; 
        ctx.filter = `blur(4px)`;
        ctx.drawImage(originalImage, 0, 0, previewWidth, previewHeight);
        ctx.filter = 'none'; ctx.globalAlpha = 1.0; 
    }

    // 3. Pixel math (Lighting, HSL, Color Grade, Clarity, Vignette)
    const imgData = ctx.getImageData(0, 0, previewWidth, previewHeight);
    processPixels(imgData.data, previewWidth, previewHeight);
    ctx.putImageData(imgData, 0, 0);

    // 4. Detail sharpen
    applySharpen(ctx, previewWidth, previewHeight, settings.sharpen);
}

document.getElementById('download-btn').onclick = () => {
    if (!originalImage) return;

    const btn = document.getElementById('download-btn');
    btn.textContent = '⏳'; 
    
    setTimeout(() => {
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = originalImage.width; exportCanvas.height = originalImage.height;
        const eCtx = exportCanvas.getContext('2d');

        eCtx.drawImage(originalImage, 0, 0);
        
        if (settings.blur > 0) {
            eCtx.globalAlpha = settings.blur / 250;
            const blurRadius = Math.max(4, (originalImage.width / 1000) * 2); 
            eCtx.filter = `blur(${blurRadius}px)`;
            eCtx.drawImage(originalImage, 0, 0);
            eCtx.filter = 'none'; eCtx.globalAlpha = 1.0;
        }

        const imgData = eCtx.getImageData(0, 0, exportCanvas.width, exportCanvas.height);
        processPixels(imgData.data, exportCanvas.width, exportCanvas.height);
        eCtx.putImageData(imgData, 0, 0);

        applySharpen(eCtx, exportCanvas.width, exportCanvas.height, settings.sharpen);

        const a = document.createElement('a');
        a.download = 'edited_photo.jpg';
        a.href = exportCanvas.toDataURL('image/jpeg', 0.95);
        a.click();

        btn.textContent = '💾';
    }, 50);
};

// Start UI
document.getElementById('panel-presets').classList.add('active');
