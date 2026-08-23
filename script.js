const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let originalImage = null;

// The central state object containing all your slider values
let settings = {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    temp: 0, tint: 0, vibrance: 0, saturation: 0,
    blur: 0, clarity: 0, grain: 0
};

// Map sliders to state
const sliders = document.querySelectorAll('input[type="range"]');
sliders.forEach(slider => {
    slider.addEventListener('input', (e) => {
        settings[e.target.id] = parseFloat(e.target.value);
        requestAnimationFrame(renderImage);
    });
});

// UI Buttons
document.getElementById('upload-btn').onclick = () => document.getElementById('file-upload').click();
document.getElementById('load-preset-btn').onclick = () => document.getElementById('load-preset').click();

// 1. Image Upload
document.getElementById('file-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        originalImage = new Image();
        originalImage.onload = () => {
            canvas.style.display = 'block';
            document.getElementById('status').style.display = 'none';
            renderImage();
        };
        originalImage.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

// 2. The Core Rendering Engine
function renderImage() {
    if (!originalImage) return;

    // Set canvas dimensions
    canvas.width = originalImage.width;
    canvas.height = originalImage.height;

    // Apply native Canvas Blur first
    ctx.filter = `blur(${settings.blur}px)`;
    ctx.drawImage(originalImage, 0, 0);
    ctx.filter = 'none';

    // Get raw pixel data for math operations
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    const factor = (259 * (settings.contrast + 255)) / (255 * (259 - settings.contrast));

    // Loop through every pixel
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i + 1], b = data[i + 2];

        // Light: Exposure
        let exp = 1 + (settings.exposure / 100);
        r *= exp; g *= exp; b *= exp;

        // Color: Temp & Tint
        r += settings.temp * 0.5;
        b -= settings.temp * 0.5;
        g += settings.tint * 0.5;

        // Light: Highlights, Shadows, Whites, Blacks
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        if (luminance > 128) {
            let highMod = (luminance - 128) / 128;
            r += settings.highlights * highMod;
            g += settings.highlights * highMod;
            b += settings.highlights * highMod;
        } else {
            let shadMod = (128 - luminance) / 128;
            r += settings.shadows * shadMod;
            g += settings.shadows * shadMod;
            b += settings.shadows * shadMod;
        }
        
        r += settings.whites; g += settings.whites; b += settings.whites;
        r -= settings.blacks; g -= settings.blacks; b -= settings.blacks;

        // Clarity (Midtone Contrast approximation)
        if (settings.clarity !== 0) {
            let mid = 128;
            let clarFactor = settings.clarity / 100;
            if (luminance > 64 && luminance < 192) {
                r += (r - mid) * clarFactor;
                g += (g - mid) * clarFactor;
                b += (b - mid) * clarFactor;
            }
        }

        // Color: Saturation & Vibrance
        let max = Math.max(r, g, b);
        let avg = (r + g + b) / 3;
        let satAmt = settings.saturation / 100;
        let vibAmt = settings.vibrance / 100;
        
        // Vibrance affects less saturated pixels more
        let vibAdjust = vibAmt * (1 - (max - avg) / 255); 
        let totalSat = satAmt + vibAdjust;

        r += (r - avg) * totalSat;
        g += (g - avg) * totalSat;
        b += (b - avg) * totalSat;

        // Contrast
        r = factor * (r - 128) + 128;
        g = factor * (g - 128) + 128;
        b = factor * (b - 128) + 128;

        // Effects: Grain
        if (settings.grain > 0) {
            let noise = (Math.random() - 0.5) * settings.grain;
            r += noise; g += noise; b += noise;
        }

        // Clamp values to 0-255
        data[i] = Math.min(255, Math.max(0, r));
        data[i + 1] = Math.min(255, Math.max(0, g));
        data[i + 2] = Math.min(255, Math.max(0, b));
    }

    ctx.putImageData(imgData, 0, 0);
}

// 3. Preset Management System
function updateUI() {
    sliders.forEach(slider => {
        slider.value = settings[slider.id];
    });
    renderImage();
}

// Copy preset to clipboard
document.getElementById('copy-preset').onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(settings));
    alert('Preset copied to clipboard! ✨');
};

// Paste preset from clipboard
document.getElementById('paste-preset').onclick = async () => {
    try {
        const text = await navigator.clipboard.readText();
        const newSettings = JSON.parse(text);
        settings = { ...settings, ...newSettings };
        updateUI();
    } catch (e) {
        alert('Could not paste preset. Make sure you copied a valid preset!');
    }
};

// Save preset as JSON file
document.getElementById('save-preset').onclick = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(settings));
    const a = document.createElement('a');
    a.setAttribute("href", dataStr);
    a.setAttribute("download", "my_preset.json");
    a.click();
};

// Load preset from JSON file
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

// Reset
document.getElementById('reset-btn').onclick = () => {
    Object.keys(settings).forEach(key => settings[key] = 0);
    updateUI();
};

// Download Finished Image
document.getElementById('download-btn').onclick = () => {
    if (!originalImage) return;
    const a = document.createElement('a');
    a.download = 'edited_photo.jpg';
    a.href = canvas.toDataURL('image/jpeg', 0.95);
    a.click();
};
