const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const videoSource = document.getElementById('video-source');
let originalImage = null;
let isVideo = false;

// Batch State
let isBatchMode = false;
let batchFiles = [];
let batchIndex = 0;

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

// --- Render Debouncing ---
let renderFrameId = null;
function queueRender() {
    if (renderFrameId) cancelAnimationFrame(renderFrameId);
    renderFrameId = requestAnimationFrame(() => {
        renderPreview();
        renderFrameId = null;
    });
}

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

// --- UI Navigation ---
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
    queueRender();
}

sliders.forEach(slider => {
    slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        settings[e.target.id] = val;
        const numInp = document.getElementById(`num-${e.target.id}`);
        if (numInp) numInp.value = val;
        queueRender(); 
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
        queueRender();
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

// --- File Handling Core (No Auto-Looping) ---
function loadFile(file) {
    if (!file) return;
    
    isVideo = file.type.startsWith('video/');
    const url = URL.createObjectURL(file);
    const MAX_PREVIEW_SIZE = isVideo ? 600 : 800;
    
    canvas.style.display = 'block';
    document.getElementById('status').style.display = 'none';
    document.getElementById('download-btn').disabled = false;
    document.getElementById('auto-btn').disabled = false;

    if (isVideo) {
        videoSource.src = url;
        videoSource.pause();
        videoSource.removeAttribute('loop');
        
        videoSource.onloadeddata = () => {
            const width = videoSource.videoWidth;
            const height = videoSource.videoHeight;
            const scale = Math.min(1, MAX_PREVIEW_SIZE / Math.max(width, height));
            previewWidth = Math.floor(width * scale);
            previewHeight = Math.floor(height * scale);
            canvas.width = previewWidth;
            canvas.height = previewHeight;
            
            // Seek to first frame cleanly without auto-playing/looping
            videoSource.currentTime = 0.1;
        };
        
        videoSource.onseeked = () => {
            queueRender();
        };
    } else {
        originalImage = new Image();
        originalImage.onload = () => {
            const width = originalImage.naturalWidth || originalImage.width;
            const height = originalImage.naturalHeight || originalImage.height;
            const scale = Math.min(1, MAX_PREVIEW_SIZE / Math.max(width, height));
            previewWidth = Math.floor(width * scale);
            previewHeight = Math.floor(height * scale);
            canvas.width = previewWidth;
            canvas.height = previewHeight;
            
            setTimeout(() => { queueRender(); }, 50);
        };
        originalImage.src = url;
    }
}

document.getElementById('upload-btn').onclick = () => document.getElementById('file-upload').click();
document.getElementById('file-upload').addEventListener('change', (e) => loadFile(e.target.files[0]));

// --- Intuitive Auto Enhance ---
document.getElementById('auto-btn').addEventListener('click', () => {
    if (!originalImage && !isVideo) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = previewWidth; tempCanvas.height = previewHeight;
    const tCtx = tempCanvas.getContext('2d');
    
    if (isVideo) tCtx.drawImage(videoSource, 0, 0, previewWidth, previewHeight);
    else tCtx.drawImage(originalImage, 0, 0, previewWidth, previewHeight);

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

    const avgLum = sumLum / totalPixels;
    settings.exposure = Math.round(Math.max(-40, Math.min(40, (128 - avgLum) * 0.5)));
    settings.contrast = 10;
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

// --- Interactive Batch Queue Engine ---
const batchBtn = document.getElementById('batch-process-btn');
const batchInput = document.getElementById('batch-file-input');

batchBtn.onclick = () => batchInput.click();

batchInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    
    isBatchMode = true;
    batchFiles = files;
    batchIndex = 0;
    
    document.getElementById('batch-ui').style.display = 'flex';
    document.querySelector('.bottom-nav').style.display = 'none';
    loadBatchItem();
});

function loadBatchItem() {
    if (batchIndex >= batchFiles.length) {
        exitBatchMode();
        return;
    }
    document.getElementById('batch-count').innerText = `${batchIndex + 1} / ${batchFiles.length}`;
    loadFile(batchFiles[batchIndex]);
}

function exitBatchMode() {
    isBatchMode = false;
    batchFiles = [];
    document.getElementById('batch-ui').style.display = 'none';
    document.querySelector('.bottom-nav').style.display = 'flex';
    batchInput.value = '';
    alert('Batch export complete! ✨');
}

document.getElementById('batch-download-btn').onclick = async () => {
    await exportCurrentFile(); 
    batchIndex++;
    loadBatchItem();
};
document.getElementById('batch-skip-btn').onclick = () => {
    batchIndex++;
    loadBatchItem();
};
document.getElementById('batch-cancel-btn').onclick = exitBatchMode;

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

// --- Math & Pixel Processing Engine ---
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
    return [(rgb[0] - 128) * luminanceWeight, (rgb[1] - 128) * luminanceWeight, (rgb[2] - 128) * luminanceWeight];
}

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

        r = Math.max(0, Math.min(255, r));
        g = Math.max(0, Math.min(255, g));
        b = Math.max(0, Math.min(255, b));

        let [h, s, l] = rgbToHsl(r, g, b);
        let luminance = Math.max(0, Math.min(255, 0.299 * r + 0.587 * g + 0.114 * b));

        let cLum = applyCurve(luminance, currentSettings.curveHigh, currentSettings.curveLight, currentSettings.curveDark, currentSettings.curveShadow);
        let cRatio = (luminance <= 0) ? 0 : (cLum / luminance);
        r *= cRatio; g *= cRatio; b *= cRatio;

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
    if (isVideo) {
        ctx.drawImage(videoSource, 0, 0, previewWidth, previewHeight);
        const imgData = ctx.getImageData(0, 0, previewWidth, previewHeight);
        processPixels(imgData.data, previewWidth, previewHeight, settings);
        ctx.putImageData(imgData, 0, 0);
    } else if (originalImage) {
        ctx.drawImage(originalImage, 0, 0, previewWidth, previewHeight);
        const imgData = ctx.getImageData(0, 0, previewWidth, previewHeight);
        processPixels(imgData.data, previewWidth, previewHeight, settings);
        ctx.putImageData(imgData, 0, 0);
    }
}

// --- Safe Frame-by-Frame Video / Image Export ---
async function exportCurrentFile() {
    if (!originalImage && !isVideo) return;
    
    const btnId = isBatchMode ? 'batch-download-btn' : 'download-btn';
    const btn = document.getElementById(btnId);
    const prevText = btn.textContent;
    btn.textContent = '⏳'; 

    return new Promise(resolve => {
        setTimeout(() => {
            if (!isVideo) {
                const exportCanvas = document.createElement('canvas');
                const width = originalImage.naturalWidth || originalImage.width;
                const height = originalImage.naturalHeight || originalImage.height;
                exportCanvas.width = width; exportCanvas.height = height;
                const eCtx = exportCanvas.getContext('2d');
                eCtx.drawImage(originalImage, 0, 0, width, height);
                const imgData = eCtx.getImageData(0, 0, width, height);
                processPixels(imgData.data, width, height, settings);
                eCtx.putImageData(imgData, 0, 0);

                const a = document.createElement('a');
                a.download = `edited_${Date.now()}.jpg`;
                a.href = exportCanvas.toDataURL('image/jpeg', 0.95);
                a.click();
                btn.textContent = prevText;
                resolve();
            } else {
                // For video export safety on mobile: snapshot the current paused frame cleanly
                const exportCanvas = document.createElement('canvas');
                exportCanvas.width = videoSource.videoWidth;
                exportCanvas.height = videoSource.videoHeight;
                const eCtx = exportCanvas.getContext('2d');
                eCtx.drawImage(videoSource, 0, 0, exportCanvas.width, exportCanvas.height);
                const imgData = eCtx.getImageData(0, 0, exportCanvas.width, exportCanvas.height);
                processPixels(imgData.data, exportCanvas.width, exportCanvas.height, settings);
                eCtx.putImageData(imgData, 0, 0);

                const a = document.createElement('a');
                a.download = `edited_frame_${Date.now()}.jpg`;
                a.href = exportCanvas.toDataURL('image/jpeg', 0.95);
                a.click();
                btn.textContent = prevText;
                alert("Video frame processed and saved as an edited high-res still! ✨");
                resolve();
            }
        }, 50);
    });
}

document.getElementById('download-btn').onclick = () => exportCurrentFile();
document.getElementById('panel-presets').classList.add('active');
