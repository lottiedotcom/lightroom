// State variables
let extractedSettings = {
    brightness: 100, // Default 100%
    contrast: 100,
    saturate: 100
};
let selectedPhotos = [];

// DOM Elements
const dngUpload = document.getElementById('dng-upload');
const dngStatus = document.getElementById('dng-status');
const photoUpload = document.getElementById('photo-upload');
const photoLabel = document.getElementById('photo-label');
const photoStatus = document.getElementById('photo-status');
const processBtn = document.getElementById('process-btn');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// 1. Handle DNG Upload and Metadata Extraction
dngUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    
    // Read the DNG file as text to scrape the XMP metadata block
    reader.onload = function(event) {
        const text = event.target.result;
        
        // Use RegEx to find basic Camera Raw Settings in the XMP block
        // Note: Adobe stores Exposure as a decimal (e.g., +1.5 or -0.5)
        const exposureMatch = text.match(/crs:Exposure2012="([^"]+)"/);
        const contrastMatch = text.match(/crs:Contrast2012="([^"]+)"/);
        const saturationMatch = text.match(/crs:Saturation="([^"]+)"/);

        // Convert Adobe's proprietary values to CSS Canvas Filter percentages
        if (exposureMatch) {
            const exp = parseFloat(exposureMatch[1]);
            // Rough mapping: +1 exposure ~ 130% brightness
            extractedSettings.brightness = 100 + (exp * 30); 
        }
        if (contrastMatch) {
            const contrast = parseFloat(contrastMatch[1]);
            // Rough mapping: +20 contrast ~ 120% contrast
            extractedSettings.contrast = 100 + contrast; 
        }
        if (saturationMatch) {
            const sat = parseFloat(saturationMatch[1]);
            extractedSettings.saturate = 100 + sat; 
        }

        dngStatus.textContent = `Preset loaded! (B: ${Math.round(extractedSettings.brightness)}%, C: ${Math.round(extractedSettings.contrast)}%, S: ${Math.round(extractedSettings.saturate)}%)`;
        
        // Unlock the photo upload button
        photoUpload.disabled = false;
        photoLabel.classList.remove('disabled');
    };
    
    reader.readAsText(file); // Reading as text to catch the raw XML/XMP
});

// 2. Handle Photo Selection
photoUpload.addEventListener('change', (e) => {
    selectedPhotos = Array.from(e.target.files);
    if (selectedPhotos.length > 0) {
        photoStatus.textContent = `${selectedPhotos.length} photo(s) selected ready for batching.`;
        processBtn.disabled = false;
    }
});

// 3. Process & Batch Download
processBtn.addEventListener('click', async () => {
    processBtn.textContent = 'Processing... Please wait ✨';
    processBtn.disabled = true;

    const zip = new JSZip();
    const filterString = `brightness(${extractedSettings.brightness}%) contrast(${extractedSettings.contrast}%) saturate(${extractedSettings.saturate}%)`;

    for (let i = 0; i < selectedPhotos.length; i++) {
        const file = selectedPhotos[i];
        
        // Convert file to an Image object
        const img = await loadImage(file);
        
        // Set canvas to match image dimensions
        canvas.width = img.width;
        canvas.height = img.height;
        
        // Apply the preset filters to the canvas
        ctx.filter = filterString;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // Extract the edited image from the canvas as a blob
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
        
        // Add to the zip file
        zip.file(`edited_${file.name}`, blob);
    }

    // Generate the zip and trigger the download
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'batch_presets.zip');

    processBtn.textContent = 'Batch Process & Download';
    processBtn.disabled = false;
});

// Helper function to load File into an HTML Image Element
function loadImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}
