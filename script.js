const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let originalImage = null;

// Settings for optimization
const MAX_PREVIEW_SIZE = 800; 
let previewWidth = 0;
let previewHeight = 0;

let settings = {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    temp: 0, tint: 0, vibrance: 0, saturation: 0,
    blur: 0, clarity: 0, grain: 0
};

// --- Mobile Navigation Logic ---
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

// --- Initialization & UI Updates ---
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
        // requestAnimationFrame keeps the rendering synced with the screen refresh rate
        requestAnimationFrame(renderPreview); 
    });
});

// --- Upload Logic ---
document.getElementById('upload-btn').onclick = () => document.getElementById('file-upload').click();
document.getElementById('load-preset-btn').onclick = () => document.getElementById('load-preset').click();

document.getElementById('file-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        originalImage = new Image();
        originalImage.onload = () => {
            // Calculate a fast preview size
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
document.getElementById('copy-preset').onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(settings));
    alert('Preset copied! ✨');
};

document.getElementById('paste-preset').onclick = async () => {
    try {
        const text = await navigator.clipboard.readText();
        const newSettings = JSON.parse(text);
        settings = { ...settings, ...newSettings };
        updateUI();
    } catch (e) {
        alert('Could not paste preset.');
    }
};

document.getElementById('save-preset').onclick = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(settings));
    const a = document.createElement('a');
    a.setAttribute("href", dataStr);
    a.setAttribute("download", "preset.json");
    a.click();
};

document.getElementById('load-preset').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        settings = { ...settings, ...JSON.parse(event.target.result) };
        updateUI();
    };
    reader.readAsText(file);
});

document.getElementById('reset-btn').onclick = () => {
    Object.keys(settings).forEach(key => settings[key] = 0);
    updateUI();
};

// --- The Core Math Engine (Isolated for reuse) ---
function processPixels(data) {
    const factor = (259 * (settings.contrast + 255)) / (255 * (259 - settings.contrast));

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i + 1], b = data[i + 2];

        // Exposure
        let exp = 1 + (settings.exposure / 100);
        r *= exp; g *= exp; b *= exp;

        // Temp & Tint
        r += settings.temp * 0.5; b -= settings.temp * 0.5;
        g += settings.tint * 0.5;

        // Highs/Shadows
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        if (luminance > 128) {
            let highMod = (luminance - 128) / 128;
            r += settings.highlights * highMod; g += settings.highlights * highMod; b += settings.highlights * highMod;
        } else {
            let shadMod = (128 - luminance) / 128;
            r += settings.shadows * shadMod; g += settings.shadows * shadMod; b += settings.shadows * shadMod;
        }
        
        r += settings.whites; g += settings.whites; b += settings.whites;
        r -= settings.blacks; g -= settings.blacks; b -= settings.blacks;

        // Clarity
        if (settings.clarity !== 0) {
            let mid = 128;
            let clarFactor = settings.clarity / 100;
            if (luminance > 64 && luminance < 192) {
                r += (r - mid) * clarFactor; g += (g - mid) * clarFactor; b += (b - mid) * clarFactor;
            }
        }

        // Saturation & Vibrance
        let max = Math.max(r, g, b);
        let avg = (r + g + b) / 3;
        let satAmt = settings.saturation / 100;
        let vibAmt = settings.vibrance / 100;
        let vibAdjust = vibAmt * (1 - (max - avg) / 255); 
        let totalSat = satAmt + vibAdjust;

        r += (r - avg) * totalSat; g += (g - avg) * totalSat; b += (b - avg) * totalSat;

        // Contrast
        r = factor * (r - 128) + 128; g = factor * (g - 128) + 128; b = factor * (b - 128) + 128;

        // Grain
        if (settings.grain > 0) {
            let noise = (Math.random() - 0.5) * settings.grain;
            r += noise; g += noise; b += noise;
        }

        data[i] = Math.min(255, Math.max(0, r));
        data[i + 1] = Math.min(255, Math.max(0, g));
        data[i + 2] = Math.min(255, Math.max(0, b));
    }
}

// --- Render Preview (Fast) ---
function renderPreview() {
    if (!originalImage) return;

    canvas.width = previewWidth;
    canvas.height = previewHeight;

    // 1. Draw the sharp, unblurred original image first
    ctx.drawImage(originalImage, 0, 0, previewWidth, previewHeight);

    // 2. If blur is active, overlay a subtle blur to smooth skin
    if (settings.blur > 0) {
        // Map 0-100 to a subtle opacity overlay (max 40% opacity)
        ctx.globalAlpha = settings.blur / 250; 
        ctx.filter = `blur(4px)`; // Constant small radius
        ctx.drawImage(originalImage, 0, 0, previewWidth, previewHeight);
        ctx.filter = 'none';
        ctx.globalAlpha = 1.0; // Reset opacity
    }

    // 3. Process the lighting and colors on the blended result
    const imgData = ctx.getImageData(0, 0, previewWidth, previewHeight);
    processPixels(imgData.data);
    ctx.putImageData(imgData, 0, 0);
}

// --- Download Full Resolution (Slow but only happens once) ---
document.getElementById('download-btn').onclick = () => {
    if (!originalImage) return;

    const btn = document.getElementById('download-btn');
    btn.textContent = '⏳'; // Show loading state
    
    // Give the UI a tiny pause to show the loading icon before freezing to do the math
    setTimeout(() => {
        // Create an invisible canvas at FULL size
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = originalImage.width;
        exportCanvas.height = originalImage.height;
        const eCtx = exportCanvas.getContext('2d');

        // Apply the same soft-focus technique to the full resolution export
        eCtx.drawImage(originalImage, 0, 0);
        
        if (settings.blur > 0) {
            eCtx.globalAlpha = settings.blur / 250;
            // Scale the blur radius up slightly for high-res images to maintain the look
            const blurRadius = Math.max(4, (originalImage.width / 1000) * 2); 
            eCtx.filter = `blur(${blurRadius}px)`;
            eCtx.drawImage(originalImage, 0, 0);
            eCtx.filter = 'none';
            eCtx.globalAlpha = 1.0;
        }

        const imgData = eCtx.getImageData(0, 0, exportCanvas.width, exportCanvas.height);
        processPixels(imgData.data);
        eCtx.putImageData(imgData, 0, 0);

        const a = document.createElement('a');
        a.download = 'edited_photo.jpg';
        a.href = exportCanvas.toDataURL('image/jpeg', 0.95);
        a.click();

        btn.textContent = '💾'; // Reset icon
    }, 50);
};

// Initial Setup
document.getElementById('panel-presets').classList.add('active');
