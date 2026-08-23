const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let originalImage = null;
const MAX_PREVIEW_SIZE = 800; 
let previewWidth = 0, previewHeight = 0;

let settings = {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, curveHigh: 0, curveLight: 0, curveDark: 0, curveShadow: 0, whites: 0, blacks: 0,
    temp: 0, tint: 0, vibrance: 0, saturation: 0,
    pickedH: -1, pickedS: 0, pickedL: 0, pointHue: 0, pointSat: 0, pointLum: 0,
    redH: 0, redS: 0, redL: 0, orgH: 0, orgS: 0, orgL: 0, yelH: 0, yelS: 0, yelL: 0,
    grnH: 0, grnS: 0, grnL: 0, aquH: 0, aquS: 0, aquL: 0, bluH: 0, bluS: 0, bluL: 0,
    purH: 0, purS: 0, purL: 0, magH: 0, magS: 0, magL: 0,
    gradShadH: 0, gradShadS: 0, gradMidH: 0, gradMidS: 0, gradHighH: 0, gradHighS: 0,
    texture: 0, clarity: 0, dehaze: 0, blur: 0, vignette: 0, sharpen: 0, noiseRed: 0, grain: 0
};

// --- History System ---
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

// --- UI Navigation & Collapse Logic ---
const tabBtns = document.querySelectorAll('.tab-btn');
const toolPanels = document.querySelectorAll('.tool-panel');
const mainPanelsContainer = document.getElementById('main-panels-container');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const targetPanel = document.getElementById(targetId);

        if (btn.classList.contains('active')) {
            btn.classList.remove('active');
            targetPanel.classList.remove('active');
            mainPanelsContainer.style.display = 'none';
            return;
        }

        tabBtns.forEach(t => t.classList.remove('active'));
        toolPanels.forEach(p => p.classList.remove('active'));
        
        btn.classList.add('active');
        targetPanel.classList.add('active');
        mainPanelsContainer.style.display = 'block';
    });
});

// --- Sliders & Numeric Inputs ---
const sliders = document.querySelectorAll('input[type="range"]');
const numInputs = document.querySelectorAll('.val-input');

function updateUI() {
    sliders.forEach(slider => {
        if (settings[slider.id] !== undefined) {
            slider.value = settings[slider.id];
            const numInp = document.getElementById(`num-${slider.id}`);
            if (numInp) numInp.value = settings[slider.id];
        }
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
    slider.addEventListener('change', () => { saveHistory(); });
});

numInputs.forEach(numInp => {
    const settingKey = numInp.id.replace('num-', '');
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

    numInp.addEventListener('change', (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val)) val = 0;
        const min = parseFloat(numInp.min), max = parseFloat(numInp.max);
        if (!isNaN(min) && val < min) val = min;
        if (!isNaN(max) && val > max) val = max;
        numInp.value = val;
        settings[settingKey] = val;
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
            const width = originalImage.naturalWidth || originalImage.width;
            const height = originalImage.naturalHeight || originalImage.height;
            const scale = Math.min(1, MAX_PREVIEW_SIZE / Math.max(width, height));
            
            previewWidth = Math.floor(width * scale);
            previewHeight = Math.floor(height * scale);
            
            canvas.style.display = 'block';
            document.getElementById('status').style.display = 'none';
            document.getElementById('download-btn').disabled = false;
            document.getElementById('auto-btn').disabled = false;
            
            setTimeout(() => {
                renderPreview();
            }, 50);
        };
        originalImage.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

// --- Intuitive Auto Enhancement ---
document.getElementById('auto-btn').addEventListener('click', () => {
    if (!originalImage) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = previewWidth; tempCanvas.height = previewHeight;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.drawImage(originalImage, 0, 0, previewWidth, previewHeight);

    const rawData = tCtx.getImageData(0, 0, previewWidth, previewHeight).data;
    const totalPixels = rawData.length / 4;
    let sumR = 0, sumG = 0, sumB = 0, sumLum = 0;
    const histogram = new Array(256).fill(0);

    for (let i = 0; i < rawData.length; i += 4) {
        const r = rawData[i], g = rawData[i+1], b = rawData[i+2];
        const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        sumR += r; sumG += g; sumB += b; sumLum += lum;
        histogram[lum]++;
    }

    const avgR = sumR / totalPixels, avgG = sumG / totalPixels, avgB = sumB / totalPixels, avgLum = sumLum / totalPixels;

    let count = 0, p1 = 0, p99 = 255;
    for (let i = 0; i < 256; i++) {
        count += histogram[i];
        if (p1 === 0 && count >= totalPixels * 0.01) p1 = i;
        if (count >= totalPixels * 0.99) { p99 = i; break; }
    }

    let targetExp = (128 - avgLum) * 0.5;
    settings.exposure = Math.round(Math.max(-40, Math.min(40, targetExp)));

    let dynamicRange = p99 - p1;
    if (dynamicRange < 180) settings.contrast = Math.round(Math.min(35, (180 - dynamicRange) * 0.35));
    else if (dynamicRange > 240) settings.contrast = -10;
    else settings.contrast = 5;

    if (p99 > 240) settings.highlights = -25;
    else if (p99 < 200) settings.highlights = 15;
    else settings.highlights = 0;

    if (p1 < 15) settings.shadows = 25;
    else if (p1 > 40) settings.shadows = -10;
    else settings.shadows = 0;

    settings.whites = Math.round(Math.max(-20, Math.min(20, (240 - p99) * 0.3)));
    settings.blacks = Math.round(Math.max(-20, Math.min(20, (p1 - 10) * 0.3)));

    const avgGray = (avgR + avgG + avgB) / 3;
    const rDiff = avgR - avgGray, bDiff = avgB - avgGray;
    settings.temp = Math.round(Math.max(-30, Math.min(30, (bDiff - rDiff) * 0.4)));

    const gDiff = avgG - ((avgR + avgB) / 2);
    settings.tint = Math.round(Math.max(-25, Math.min(25, -gDiff * 0.5)));
    settings.vibrance = 12;

    updateUI();
    saveHistory();
});

// --- Presets & Batch Processing ---
document.getElementById('copy-preset').onclick = () => { navigator.clipboard.writeText(JSON.stringify(settings)); alert('Preset copied! ✨'); };
document.getElementById('paste-preset').onclick = async () => { try { const text = await navigator.clipboard.readText(); settings = { ...settings, ...JSON.parse(text) }; updateUI(); saveHistory(); } catch (e) { alert('Could not paste preset.'); }};
document.getElementById('save-preset').onclick = () => { const a = document.createElement('a'); a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(settings)); a.download = "preset.json"; a.click(); };
document.getElementById('load-preset-btn').onclick = () => document.getElementById('load-preset').click();
document.getElementById('load-preset').addEventListener('change', (e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (event) => { settings = { ...settings, ...JSON.parse(event.target.result) }; updateUI(); saveHistory(); }; reader.readAsText(file); });
document.getElementById('reset-btn').onclick = () => { Object.keys(settings).forEach(key => settings[key] = (key === 'pickedH' ? -1 : 0)); updateUI(); saveHistory(); };

// --- Batch Process Engine ---
const batchBtn = document.getElementById('batch-process-btn');
const batchInput = document.getElementById('batch-file-input');

batchBtn.onclick = () => batchInput.click();

batchInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    batchBtn.disabled = true;
    batchBtn.textContent = `Processing 0/${files.length}... ⏳`;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        batchBtn.textContent = `Processing ${i + 1}/${files.length}... ⏳`;
        
        await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const processedCanvas = processImageCanvas(img, settings);
                    const a = document.createElement('a');
                    const nameParts = file.name.split('.');
                    const ext = nameParts.pop();
                    a.download = `${nameParts.join('.')}_edited.jpg`;
                    a.href = processedCanvas.toDataURL('image/jpeg', 0.95);
                    a.click();
                    setTimeout(resolve, 350);
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    batchBtn.disabled = false;
    batchBtn.textContent = '📦 Batch Apply & Export';
    batchInput.value = '';
    alert('Batch export complete! ✨');
});

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
    let h = 0, s = 0, l = (max + min) / 2; 
    
    if (max !== min) {
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
    if (s === 0) {
        r = g = b = l; 
    } else {
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

function getGradingColor(hue, sat, luminanceWeight) {
    if (sat === 0) return [0, 0, 0];
    const rgb = hslToRgb(hue, sat / 100, 0.5);
    return [
        (rgb[0] - 128) * luminanceWeight,
        (rgb[1] - 128) * luminanceWeight,
        (rgb[2] - 128) * luminanceWeight
    ];
}

// --- Main Processing Engine ---
function processPixels(data, width, height, currentSettings = settings) {
    const factor = (259 * (currentSettings.contrast + 255)) / (255 * (259 - currentSettings.contrast));
    const cx = width / 2; const cy = height / 2;
    const maxDist = Math.sqrt(cx*cx + cy*cy);

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i + 1], b = data[i + 2];
        let x = (i / 4) % width, y = Math.floor((i / 4) / width);

        let exp = 1 + (currentSettings.exposure / 100);
        r *= exp; g *= exp; b *= exp;
        r += currentSettings.temp * 0.5; b -= currentSettings.temp * 0.5;
        g += currentSettings.tint * 0.5;

        if (currentSettings.dehaze !== 0) {
            let dAmt = currentSettings.dehaze / 100;
            let darkFactor = 1 - ((r+g+b)/3 / 255);
            r -= dAmt * 20 * darkFactor; 
            g -= dAmt * 25 * darkFactor; 
            b -= dAmt * 40 * darkFactor; 
        }

        r = Math.max(0, Math.min(255, r));
        g = Math.max(0, Math.min(255, g));
        b = Math.max(0, Math.min(255, b));

        let [h, s, l] = rgbToHsl(r, g, b);
        let hMod = 0, sMod = 0, lMod = 0;

        if (h > 345 || h <= 15) { hMod=currentSettings.redH; sMod=currentSettings.redS; lMod=currentSettings.redL; }
        else if (h > 15 && h <= 45) { hMod=currentSettings.orgH; sMod=currentSettings.orgS; lMod=currentSettings.orgL; }
        else if (h > 45 && h <= 75) { hMod=currentSettings.yelH; sMod=currentSettings.yelS; lMod=currentSettings.yelL; }
        else if (h > 75 && h <= 150) { hMod=currentSettings.grnH; sMod=currentSettings.grnS; lMod=currentSettings.grnL; }
        else if (h > 150 && h <= 200) { hMod=currentSettings.aquH; sMod=currentSettings.aquS; lMod=currentSettings.aquL; }
        else if (h > 200 && h <= 260) { hMod=currentSettings.bluH; sMod=currentSettings.bluS; lMod=currentSettings.bluL; }
        else if (h > 260 && h <= 290) { hMod=currentSettings.purH; sMod=currentSettings.purS; lMod=currentSettings.purL; }
        else if (h > 290 && h <= 345) { hMod=currentSettings.magH; sMod=currentSettings.magS; lMod=currentSettings.magL; }

        if (currentSettings.pickedH !== -1) {
            let hueDist = Math.min(Math.abs(h - currentSettings.pickedH), 360 - Math.abs(h - currentSettings.pickedH));
            if (hueDist < 30) {
                let strength = 1 - (hueDist / 30);
                hMod += currentSettings.pointHue * strength;
                sMod += currentSettings.pointSat * strength;
                lMod += currentSettings.pointLum * strength; 
            }
        }

        if (hMod !== 0 || sMod !== 0 || lMod !== 0) {
            h = (h + hMod + 360) % 360;
            s = Math.max(0, Math.min(1, s + (sMod / 100)));
            l = Math.max(0, Math.min(1, l + (lMod / 100))); 
            [r, g, b] = hslToRgb(h, s, l);
        }

        let luminance = Math.max(0, Math.min(255, 0.299 * r + 0.587 * g + 0.114 * b));
        
        if (currentSettings.gradShadS > 0 && luminance < 128) {
            let weight = (128 - luminance) / 128;
            let [cR, cG, cB] = getGradingColor(currentSettings.gradShadH, currentSettings.gradShadS, weight);
            r += cR; g += cG; b += cB;
        }
        if (currentSettings.gradMidS > 0) {
            let weight = 1 - (Math.abs(luminance - 128) / 128);
            let [cR, cG, cB] = getGradingColor(currentSettings.gradMidH, currentSettings.gradMidS, weight);
            r += cR; g += cG; b += cB;
        }
        if (currentSettings.gradHighS > 0 && luminance >= 128) {
            let weight = (luminance - 128) / 128;
            let [cR, cG, cB] = getGradingColor(currentSettings.gradHighH, currentSettings.gradHighS, weight);
            r += cR; g += cG; b += cB;
        }

        let cLum = applyCurve(luminance, currentSettings.curveHigh, currentSettings.curveLight, currentSettings.curveDark, currentSettings.curveShadow);
        let cRatio = (luminance <= 0) ? 0 : (cLum / luminance);
        r *= cRatio; g *= cRatio; b *= cRatio;

        if (luminance > 128) {
            let highMod = (luminance - 128) / 128;
            r += currentSettings.highlights * highMod; g += currentSettings.highlights * highMod; b += currentSettings.highlights * highMod;
        } else {
            let shadMod = (128 - luminance) / 128;
            r += currentSettings.shadows * shadMod; g += currentSettings.shadows * shadMod; b += currentSettings.shadows * shadMod;
        }
        r += currentSettings.whites; g += currentSettings.whites; b += currentSettings.whites;
        r -= currentSettings.blacks; g -= currentSettings.blacks; b -= currentSettings.blacks;

        if (currentSettings.clarity !== 0 || currentSettings.texture !== 0) {
            let cAmt = currentSettings.clarity / 100;
            let tAmt = currentSettings.texture / 100;
            let midWeight = 1 - (Math.abs(luminance - 128) / 128); 
            r += (r - luminance) * (cAmt + (tAmt * 0.5)) * midWeight; 
            g += (g - luminance) * (cAmt + (tAmt * 0.5)) * midWeight; 
            b += (b - luminance) * (cAmt + (tAmt * 0.5)) * midWeight;
        }

        let maxRGB = Math.max(r, g, b);
        let avgRGB = (r + g + b) / 3;
        let totalSat = (currentSettings.saturation / 100) + ((currentSettings.vibrance / 100) * (1 - (maxRGB - avgRGB) / 255));
        r += (r - avgRGB) * totalSat; g += (g - avgRGB) * totalSat; b += (b - avgRGB) * totalSat;

        r = factor * (r - 128) + 128; g = factor * (g - 128) + 128; b = factor * (b - 128) + 128;

        if (currentSettings.vignette !== 0) {
            let dist = Math.sqrt((x-cx)*(x-cx) + (y-cy)*(y-cy));
            let vigAmt = (currentSettings.vignette / 100); 
            let vigMod = 1 + (vigAmt * Math.pow(dist / maxDist, 2)); 
            r *= vigMod; g *= vigMod; b *= vigMod;
        }

        if (currentSettings.grain > 0) {
            let noise = (Math.random() - 0.5) * currentSettings.grain;
            r += noise; g += noise; b += noise;
        }

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

// --- Unified Render Processor (Preview & High-Res Export) ---
function processImageCanvas(img, currentSettings) {
    const fullCanvas = document.createElement('canvas');
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    fullCanvas.width = width;
    fullCanvas.height = height;
    
    const eCtx = fullCanvas.getContext('2d');
    eCtx.drawImage(img, 0, 0, width, height);

    // Dynamic blur radius calibrated to resolution
    if (currentSettings.blur > 0 || currentSettings.noiseRed > 0) {
        const previewScale = Math.min(1, MAX_PREVIEW_SIZE / Math.max(width, height));
        const scaleRatio = 1 / previewScale;
        const baseRad = currentSettings.blur > 0 ? 4 : (currentSettings.noiseRed / 20);
        const bRad = Math.max(1, baseRad * scaleRatio);

        eCtx.globalAlpha = currentSettings.blur > 0 ? (currentSettings.blur / 250) : (currentSettings.noiseRed / 100);
        eCtx.filter = `blur(${bRad}px)`;
        eCtx.drawImage(img, 0, 0, width, height);
        eCtx.filter = 'none';
        eCtx.globalAlpha = 1.0;
    }

    const imgData = eCtx.getImageData(0, 0, width, height);
    processPixels(imgData.data, width, height, currentSettings);
    eCtx.putImageData(imgData, 0, 0);

    if (currentSettings.sharpen > 0) {
        applySharpen(eCtx, width, height, currentSettings.sharpen);
    }

    return fullCanvas;
}

function renderPreview() {
    if (!originalImage) return;
    canvas.width = previewWidth; canvas.height = previewHeight;
    ctx.drawImage(originalImage, 0, 0, previewWidth, previewHeight);

    if (settings.blur > 0 || settings.noiseRed > 0) {
        let bRad = settings.blur > 0 ? 4 : (settings.noiseRed / 20); 
        ctx.globalAlpha = settings.blur > 0 ? (settings.blur / 250) : (settings.noiseRed / 100); 
        ctx.filter = `blur(${bRad}px)`;
        ctx.drawImage(originalImage, 0, 0, previewWidth, previewHeight);
        ctx.filter = 'none'; ctx.globalAlpha = 1.0; 
    }

    const imgData = ctx.getImageData(0, 0, previewWidth, previewHeight);
    processPixels(imgData.data, previewWidth, previewHeight, settings);
    ctx.putImageData(imgData, 0, 0);
    applySharpen(ctx, previewWidth, previewHeight, settings.sharpen);
}

document.getElementById('download-btn').onclick = () => {
    if (!originalImage) return;
    const btn = document.getElementById('download-btn');
    btn.textContent = '⏳'; 
    setTimeout(() => {
        const exportCanvas = processImageCanvas(originalImage, settings);
        const a = document.createElement('a');
        a.download = 'raw_edited.jpg';
        a.href = exportCanvas.toDataURL('image/jpeg', 0.95);
        a.click();
        btn.textContent = '💾';
    }, 50);
};

document.getElementById('panel-presets').classList.add('active');
