const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let originalImage = null;
const MAX_PREVIEW_SIZE = 800; 
let previewWidth = 0, previewHeight = 0;

let settings = {
    // Light
    exposure: 0, contrast: 0, curveHigh: 0, curveLight: 0, curveDark: 0, curveShadow: 0, whites: 0, blacks: 0,
    // Color
    temp: 0, tint: 0, vibrance: 0, saturation: 0,
    // Point Color
    pickedH: -1, pickedS: 0, pickedL: 0, pointHue: 0, pointSat: 0, pointLum: 0,
    // 8-Channel HSL 
    redH: 0, redS: 0, redL: 0, orgH: 0, orgS: 0, orgL: 0, yelH: 0, yelS: 0, yelL: 0,
    grnH: 0, grnS: 0, grnL: 0, aquH: 0, aquS: 0, aquL: 0, bluH: 0, bluS: 0, bluL: 0,
    purH: 0, purS: 0, purL: 0, magH: 0, magS: 0, magL: 0,
    // Grading
    gradShadH: 0, gradShadS: 0, gradMidH: 0, gradMidS: 0, gradHighH: 0, gradHighS: 0,
    // Presence & Detail
    texture: 0, clarity: 0, dehaze: 0, blur: 0, vignette: 0, sharpen: 0, noiseRed: 0, grain: 0
};

// --- History System (Undo / Redo) ---
let history = [];
let historyIndex = -1;

function saveHistory() {
    history = history.slice(0, historyIndex + 1);
    history.push(JSON.parse(JSON.stringify(settings)));
    historyIndex++;
    updateHistoryButtons();
}

function updateHistoryButtons() {
    document.getElementById('undo-btn').disabled = historyIndex <= 0;
    document.getElementById('redo-btn').disabled = historyIndex >= history.length - 1;
}

document.getElementById('undo-btn').addEventListener('click', () => {
    if (historyIndex > 0) {
        historyIndex--;
        settings = JSON.parse(JSON.stringify(history[historyIndex]));
        updateUI();
        updateHistoryButtons();
    }
});

document.getElementById('redo-btn').addEventListener('click', () => {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        settings = JSON.parse(JSON.stringify(history[historyIndex]));
        updateUI();
        updateHistoryButtons();
    }
});

saveHistory();

// --- UI Navigation ---
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

// --- Sliders & Numeric Inputs (Two-Way Binding) ---
const sliders = document.querySelectorAll('input[type="range"]');
const numInputs = document.querySelectorAll('.val-input');

function updateUI() {
    sliders.forEach(slider => {
        slider.value = settings[slider.id];
        const numInp = document.getElementById(`num-${slider.id}`);
        if (numInp) numInp.value = settings[slider.id];
    });
    requestAnimationFrame(renderPreview);
}

sliders.forEach(slider => {
    slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        settings[e.target.id] = val;
        const numInp = document.getElementById(`num-${e.target.id}`);
        if (numInp) numInp.value = val;
        requestAnimationFrame(renderPreview); 
    });
    slider.addEventListener('change', () => {
        saveHistory();
    });
});

numInputs.forEach(numInp => {
    const settingKey = numInp.id.replace('num-', '');
    
    // Live update when typing
    numInp.addEventListener('input', (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val)) return;
        const min = parseFloat(numInp.min), max = parseFloat(numInp.max);
        if (!isNaN(min) && val < min) val = min;
        if (!isNaN(max) && val > max) val = max;

        settings[settingKey] = val;
        const slider = document.getElementById(settingKey);
        if (slider) slider.value = val;
        requestAnimationFrame(renderPreview);
    });

    // Save history and sanitize on blur / enter
    numInp.addEventListener('change', (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val)) val = 0;
        const min = parseFloat(numInp.min), max = parseFloat(numInp.max);
        if (!isNaN(min) && val < min) val = min;
        if (!isNaN(max) && val > max) val = max;
        numInp.value = val;
        settings[settingKey] = val;
        const slider = document.getElementById(settingKey);
        if (slider) slider.value = val;
        updateUI();
        saveHistory();
    });
});

// --- Upload & File Setup ---
document.getElementById('upload-btn').onclick = () => document.getElementById('file-upload').click();
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
            document.getElementById('auto-btn').disabled = false;
            renderPreview();
        };
        originalImage.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

// --- Intuitive Auto Enhancement Engine ---
document.getElementById('auto-btn').addEventListener('click', () => {
    if (!originalImage) return;

    // Draw untouched preview to a temporary canvas for pixel inspection
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = previewWidth;
    tempCanvas.height = previewHeight;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.drawImage(originalImage, 0, 0, previewWidth, previewHeight);

    const rawData = tCtx.getImageData(0, 0, previewWidth, previewHeight).data;
    const totalPixels = rawData.length / 4;

    let sumR = 0, sumG = 0, sumB = 0, sumLum = 0;
    const histogram = new Array(256).fill(0);

    for (let i = 0; i < rawData.length; i += 4) {
        const r = rawData[i], g = rawData[i+1], b = rawData[i+2];
        const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        sumR += r; sumG += g; sumB += b;
        sumLum += lum;
        histogram[lum]++;
    }

    const avgR = sumR / totalPixels;
    const avgG = sumG / totalPixels;
    const avgB = sumB / totalPixels;
    const avgLum = sumLum / totalPixels;

    // 1. Calculate Percentiles (1% shadow floor, 99% highlight ceiling)
    let count = 0, p1 = 0, p99 = 255;
    for (let i = 0; i < 256; i++) {
        count += histogram[i];
        if (p1 === 0 && count >= totalPixels * 0.01) p1 = i;
        if (count >= totalPixels * 0.99) { p99 = i; break; }
    }

    // 2. Exposure: target mid-tone balance around 128
    let targetExp = (128 - avgLum) * 0.5;
    settings.exposure = Math.round(Math.max(-40, Math.min(40, targetExp)));

    // 3. Contrast & Tone Curve (Dynamic Range Stretching)
    let dynamicRange = p99 - p1;
    if (dynamicRange < 180) {
        settings.contrast = Math.round(Math.min(35, (180 - dynamicRange) * 0.35));
    } else if (dynamicRange > 240) {
        settings.contrast = -10; // Soften harsh blown contrast
    } else {
        settings.contrast = 5;
    }

    // 4. Highlights and Shadows Balancing
    if (p99 > 240) settings.highlights = -25; // Pull back harsh blown highlights
    else if (p99 < 200) settings.highlights = 15;

    if (p1 < 15) settings.shadows = 25; // Lift crushed dark shadows
    else if (p1 > 40) settings.shadows = -10;

    settings.whites = Math.round(Math.max(-20, Math.min(20, (240 - p99) * 0.3)));
    settings.blacks = Math.round(Math.max(-20, Math.min(20, (p1 - 10) * 0.3)));

    // 5. White Balance (Gray-World Color Cast Correction)
    const avgGray = (avgR + avgG + avgB) / 3;
    // Temp: warm vs cool cast
    const rDiff = avgR - avgGray;
    const bDiff = avgB - avgGray;
    settings.temp = Math.round(Math.max(-30, Math.min(30, (bDiff - rDiff) * 0.4)));

    // Tint: green vs magenta cast
    const gDiff = avgG - ((avgR + avgB) / 2);
    settings.tint = Math.round(Math.max(-25, Math.min(25, -gDiff * 0.5)));

    // 6. Color Pop: clean subtle vibrance boost
    settings.vibrance = 12;

    updateUI();
    saveHistory();
});

// --- Presets ---
document.getElementById('copy-preset').onclick = () => { navigator.clipboard.writeText(JSON.stringify(settings)); alert('Preset copied! ✨'); };
document.getElementById('paste-preset').onclick = async () => { try { const text = await navigator.clipboard.readText(); settings = { ...settings, ...JSON.parse(text) }; updateUI(); saveHistory(); } catch (e) { alert('Could not paste preset.'); }};
document.getElementById('save-preset').onclick = () => { const a = document.createElement('a'); a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(settings)); a.download = "preset.json"; a.click(); };
document.getElementById('load-preset-btn').onclick = () => document.getElementById('load-preset').click();
document.getElementById('load-preset').addEventListener('change', (e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (event) => { settings = { ...settings, ...JSON.parse(event.target.result) }; updateUI(); saveHistory(); }; reader.readAsText(file); });
document.getElementById('reset-btn').onclick = () => { Object.keys(settings).forEach(key => settings[key] = (key === 'pickedH' ? -1 : 0)); updateUI(); saveHistory(); };

// --- Point Color Eyedropper ---
let isPicking = false;
const pickerBtn = document.getElementById('picker-btn');
const pickerTarget = document.getElementById('picker-target');
const pickedColorDisplay = document.getElementById('picked-color-display');

pickerBtn.addEventListener('click', () => {
    isPicking = !isPicking;
    pickerBtn.textContent = isPicking ? "Click Image to Pick..." : "Activate Eyedropper 💉";
    pickerTarget.style.display = isPicking ? "block" : "none";
});

canvas.addEventListener('mousemove', (e) => {
    if(!isPicking) return;
    pickerTarget.style.left = `${e.clientX}px`;
    pickerTarget.style.top = `${e.clientY}px`;
});

canvas.addEventListener('click', (e) => {
    if(!isPicking) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    const [h, s, l] = rgbToHsl(pixel[0], pixel[1], pixel[2]);
    
    settings.pickedH = h; settings.pickedS = s; settings.pickedL = l;
    pickedColorDisplay.style.background = `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
    
    isPicking = false;
    pickerBtn.textContent = "Activate Eyedropper 💉";
    pickerTarget.style.display = "none";
    saveHistory();
});

// --- Math Functions ---
function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) h = s = 0; 
    else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        } h /= 6;
    }
    return [h * 360, s, l];
}
function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) r = g = b = l; 
    else {
        let hue2rgb = (p, q, t) => {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        }
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        let p = 2 * l - q; h /= 360;
        r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3);
    }
    return [r * 255, g * 255, b * 255];
}

function applyCurve(lum, high, light, dark, shadow) {
    let mod = 0;
    if (lum > 192) mod = high * ((lum - 192) / 63);
    else if (lum > 128) mod = light * ((lum - 128) / 64);
    else if (lum > 64) mod = dark * ((128 - lum) / 64);
    else mod = shadow * ((64 - lum) / 64);
    return lum + mod;
}

// --- Main Processing Engine ---
function processPixels(data, width, height) {
    const factor = (259 * (settings.contrast + 255)) / (255 * (259 - settings.contrast));

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i + 1], b = data[i + 2];

        // 1. Exposure & Light
        let exp = 1 + (settings.exposure / 100);
        r *= exp; g *= exp; b *= exp;
        r += settings.temp * 0.5; b -= settings.temp * 0.5;
        g += settings.tint * 0.5;

        // 2. Dehaze
        if (settings.dehaze !== 0) {
            let dAmt = settings.dehaze / 100;
            let darkFactor = 1 - ((r+g+b)/3 / 255);
            r -= dAmt * 20 * darkFactor; 
            g -= dAmt * 25 * darkFactor; 
            b -= dAmt * 40 * darkFactor; 
        }

        // 3. HSL & Point Color
        let [h, s, l] = rgbToHsl(r, g, b);
        let hMod = 0, sMod = 0, lMod = 0;

        if (h > 345 || h <= 15) { hMod=settings.redH; sMod=settings.redS; lMod=settings.redL; }
        else if (h > 15 && h <= 45) { hMod=settings.orgH; sMod=settings.orgS; lMod=settings.orgL; }
        else if (h > 45 && h <= 75) { hMod=settings.yelH; sMod=settings.yelS; lMod=settings.yelL; }
        else if (h > 75 && h <= 150) { hMod=settings.grnH; sMod=settings.grnS; lMod=settings.grnL; }
        else if (h > 150 && h <= 200) { hMod=settings.aquH; sMod=settings.aquS; lMod=settings.aquL; }
        else if (h > 200 && h <= 260) { hMod=settings.bluH; sMod=settings.bluS; lMod=settings.bluL; }
        else if (h > 260 && h <= 290) { hMod=settings.purH; sMod=settings.purS; lMod=settings.purL; }
        else if (h > 290 && h <= 345) { hMod=settings.magH; sMod=settings.magS; lMod=settings.magL; }

        if (settings.pickedH !== -1) {
            let hueDist = Math.min(Math.abs(h - settings.pickedH), 360 - Math.abs(h - settings.pickedH));
            if (hueDist < 30) {
                let strength = 1 - (hueDist / 30);
                hMod += settings.pointHue * strength;
                sMod += settings.pointSat * strength;
                lMod += (settings.pointLum / 100) * strength;
            }
        }

        if (hMod !== 0 || sMod !== 0 || lMod !== 0) {
            h = (h + hMod + 360) % 360;
            s = Math.max(0, Math.min(1, s + (sMod / 100)));
            l = Math.max(0, Math.min(1, l + lMod));
            [r, g, b] = hslToRgb(h, s, l);
        }

        // 4. Tone Curve & Highlights/Shadows
        let luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        let cLum = applyCurve(luminance, settings.curveHigh, settings.curveLight, settings.curveDark, settings.curveShadow);
        let cRatio = cLum / (luminance + 0.001);
        r *= cRatio; g *= cRatio; b *= cRatio;

        if (luminance > 128) {
            let highMod = (luminance - 128) / 128;
            r += settings.highlights * highMod; g += settings.highlights * highMod; b += settings.highlights * highMod;
        } else {
            let shadMod = (128 - luminance) / 128;
            r += settings.shadows * shadMod; g += settings.shadows * shadMod; b += settings.shadows * shadMod;
        }
        r += settings.whites; g += settings.whites; b += settings.whites;
        r -= settings.blacks; g -= settings.blacks; b -= settings.blacks;

        // 5. Texture & Clarity
        if (settings.clarity !== 0 || settings.texture !== 0) {
            let cAmt = settings.clarity / 100;
            let tAmt = settings.texture / 100;
            let midWeight = 1 - (Math.abs(luminance - 128) / 128); 
            r += (r - luminance) * (cAmt + (tAmt * 0.5)) * midWeight; 
            g += (g - luminance) * (cAmt + (tAmt * 0.5)) * midWeight; 
            b += (b - luminance) * (cAmt + (tAmt * 0.5)) * midWeight;
        }

        // 6. Contrast & Vibrance
        let maxRGB = Math.max(r, g, b);
        let avgRGB = (r + g + b) / 3;
        let totalSat = (settings.saturation / 100) + ((settings.vibrance / 100) * (1 - (maxRGB - avgRGB) / 255));
        r += (r - avgRGB) * totalSat; g += (g - avgRGB) * totalSat; b += (b - avgRGB) * totalSat;

        r = factor * (r - 128) + 128; g = factor * (g - 128) + 128; b = factor * (b - 128) + 128;

        data[i] = Math.min(255, Math.max(0, r));
        data[i+1] = Math.min(255, Math.max(0, g));
        data[i+2] = Math.min(255, Math.max(0, b));
    }
}

function applySharpen(ctx, w, h, amount) {
    if (amount <= 0) return;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data, copy = new Uint8ClampedArray(data);
    const mix = amount / 200, w4 = w * 4;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let i = (y * w + x) * 4;
            for (let c = 0; c < 3; c++) { 
                let ic = i + c;
                let val = (copy[ic] * 5) - copy[ic-4] - copy[ic+4] - copy[ic-w4] - copy[ic+w4];
                data[ic] = copy[ic] + (val - copy[ic]) * mix;
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

function renderPreview() {
    if (!originalImage) return;
    canvas.width = previewWidth; canvas.height = previewHeight;
    ctx.drawImage(originalImage, 0, 0, previewWidth, previewHeight);

    if (settings.blur > 0 || settings.noiseRed > 0) {
        let bRad = settings.blur > 0 ? 4 : (settings.noiseRed / 20); 
        ctx.globalAlpha = settings.blur > 0 ? (settings.blur/250) : (settings.noiseRed/100); 
        ctx.filter = `blur(${bRad}px)`;
        ctx.drawImage(originalImage, 0, 0, previewWidth, previewHeight);
        ctx.filter = 'none'; ctx.globalAlpha = 1.0; 
    }

    const imgData = ctx.getImageData(0, 0, previewWidth, previewHeight);
    processPixels(imgData.data, previewWidth, previewHeight);
    ctx.putImageData(imgData, 0, 0);
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
        
        if (settings.blur > 0 || settings.noiseRed > 0) {
            eCtx.globalAlpha = settings.blur > 0 ? (settings.blur/250) : (settings.noiseRed/100); 
            let baseRad = settings.blur > 0 ? 4 : 2;
            const bRad = Math.max(baseRad, (originalImage.width / 1000) * (baseRad/2)); 
            eCtx.filter = `blur(${bRad}px)`;
            eCtx.drawImage(originalImage, 0, 0);
            eCtx.filter = 'none'; eCtx.globalAlpha = 1.0;
        }

        const imgData = eCtx.getImageData(0, 0, exportCanvas.width, exportCanvas.height);
        processPixels(imgData.data, exportCanvas.width, exportCanvas.height);
        eCtx.putImageData(imgData, 0, 0);
        applySharpen(eCtx, exportCanvas.width, exportCanvas.height, settings.sharpen);

        const a = document.createElement('a');
        a.download = 'raw_edited.jpg';
        a.href = exportCanvas.toDataURL('image/jpeg', 0.95);
        a.click();
        btn.textContent = '💾';
    }, 50);
};

document.getElementById('panel-presets').classList.add('active');
