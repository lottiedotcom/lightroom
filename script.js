const canvas = document.getElementById('gl-canvas');
const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
const videoSource = document.getElementById('video-source');
const videoControls = document.getElementById('video-controls');
const vidPlayBtn = document.getElementById('vid-play-btn');
const vidSeek = document.getElementById('vid-seek');

let originalImage = null;
let isVideo = false;
let isPlayingVideo = false;
let mediaRecorder = null;
let recordedChunks = [];

// Batch State
let isBatchMode = false;
let batchFiles = [];
let batchIndex = 0;

let previewWidth = 0, previewHeight = 0;

let settings = {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    temp: 0, tint: 0, vibrance: 0, saturation: 0, clarity: 0, vignette: 0, grain: 0
};

// --- WebGL Shader Setup (Runs Filters on the GPU) ---
const vsSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
    }
`;

const fsSource = `
    precision mediump float;
    uniform sampler2D u_image;
    varying vec2 v_texCoord;

    uniform float u_exposure;
    uniform float u_contrast;
    uniform float u_highlights;
    uniform float u_shadows;
    uniform float u_whites;
    uniform float u_blacks;
    uniform float u_temp;
    uniform float u_tint;
    uniform float u_vibrance;
    uniform float u_saturation;
    uniform float u_vignette;
    uniform float u_grain;
    uniform float u_time;

    float rand(vec2 co) {
        return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
    }

    void main() {
        vec4 color = texture2D(u_image, v_texCoord);

        // Exposure
        color.rgb *= (1.0 + (u_exposure / 100.0));

        // Temperature & Tint
        color.r += u_temp * 0.003;
        color.b -= u_temp * 0.003;
        color.g += u_tint * 0.003;

        // Contrast
        float cFactor = (u_contrast + 100.0) / 100.0;
        color.rgb = (color.rgb - 0.5) * cFactor + 0.5;

        // Luminance calculation
        float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));

        // Highlights & Shadows
        if (lum > 0.5) {
            color.rgb += (u_highlights / 255.0) * ((lum - 0.5) / 0.5);
        } else {
            color.rgb += (u_shadows / 255.0) * ((0.5 - lum) / 0.5);
        }

        // Whites & Blacks
        color.rgb += (u_whites / 255.0);
        color.rgb -= (u_blacks / 255.0);

        // Saturation & Vibrance
        float maxC = max(max(color.r, color.g), color.b);
        float minC = min(min(color.r, color.g), color.b);
        float satMod = (u_saturation / 100.0) + ((u_vibrance / 100.0) * (1.0 - (maxC - minC)));
        color.rgb = mix(vec3(lum), color.rgb, 1.0 + satMod);

        // Vignette
        if (u_vignette != 0.0) {
            float dist = distance(v_texCoord, vec2(0.5, 0.5));
            float vig = 1.0 + (u_vignette / 100.0) * pow(dist * 1.414, 2.0);
            color.rgb *= clamp(vig, 0.0, 2.0);
        }

        // Grain
        if (u_grain > 0.0) {
            float noise = (rand(v_texCoord + u_time) - 0.5) * (u_grain / 100.0);
            color.rgb += noise;
        }

        gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
    }
`;

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
}

const program = gl.createProgram();
gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vsSource));
gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fsSource));
gl.linkProgram(program);
gl.useProgram(program);

// Quad Geometry
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1, -1,  1,
    -1,  1,  1, -1,  1,  1,
]), gl.STATIC_DRAW);

const texCoordBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    0, 1,  1, 1,  0, 0,
    0, 0,  1, 1,  1, 0,
]), gl.STATIC_DRAW);

const posLocation = gl.getAttribLocation(program, "a_position");
const texLocation = gl.getAttribLocation(program, "a_texCoord");

gl.enableVertexAttribArray(posLocation);
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);

gl.enableVertexAttribArray(texLocation);
gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
gl.vertexAttribPointer(texLocation, 2, gl.FLOAT, false, 0, 0);

const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

// --- Uniform Location Cache ---
const uniforms = {};
['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temp', 'tint', 'vibrance', 'saturation', 'vignette', 'grain', 'time'].forEach(name => {
    uniforms[name] = gl.getUniformLocation(program, `u_${name}`);
});

function updateUniforms() {
    gl.uniform1f(uniforms.exposure, settings.exposure);
    gl.uniform1f(uniforms.contrast, settings.contrast);
    gl.uniform1f(uniforms.highlights, settings.highlights);
    gl.uniform1f(uniforms.shadows, settings.shadows);
    gl.uniform1f(uniforms.whites, settings.whites);
    gl.uniform1f(uniforms.blacks, settings.blacks);
    gl.uniform1f(uniforms.temp, settings.temp);
    gl.uniform1f(uniforms.tint, settings.tint);
    gl.uniform1f(uniforms.vibrance, settings.vibrance);
    gl.uniform1f(uniforms.saturation, settings.saturation);
    gl.uniform1f(uniforms.vignette, settings.vignette);
    gl.uniform1f(uniforms.grain, settings.grain);
    gl.uniform1f(uniforms.time, Math.random());
}

// --- GPU Rendering Engine (60 FPS Native) ---
function drawGPUFrame(sourceElement) {
    if (!sourceElement) return;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceElement);
    updateUniforms();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

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

// --- Sliders & Live Update ---
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
    renderCurrent();
}

function renderCurrent() {
    if (isVideo) drawGPUFrame(videoSource);
    else if (originalImage) drawGPUFrame(originalImage);
}

sliders.forEach(slider => {
    slider.addEventListener('input', (e) => {
        if (slider.id === 'vid-seek') return;
        const val = parseFloat(e.target.value);
        settings[e.target.id] = val;
        const numInp = document.getElementById(`num-${e.target.id}`);
        if (numInp) numInp.value = val;
        renderCurrent();
    });
});

numInputs.forEach(numInp => {
    const settingKey = numInp.id.replace('num-', '');
    numInp.addEventListener('input', (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val)) return;
        settings[settingKey] = val;
        const slider = document.getElementById(settingKey);
        if (slider) slider.value = val;
        renderCurrent();
    });
});

// --- File Handling Core ---
function loadFile(file) {
    if (!file) return;
    
    isVideo = file.type.startsWith('video/');
    const url = URL.createObjectURL(file);
    
    canvas.style.display = 'block';
    document.getElementById('status').style.display = 'none';
    document.getElementById('download-btn').disabled = false;
    document.getElementById('auto-btn').disabled = false;

    if (isVideo) {
        originalImage = null;
        videoControls.style.display = 'flex';
        videoSource.src = url;
        videoSource.pause();
        isPlayingVideo = false;
        vidPlayBtn.textContent = '▶️';

        videoSource.onloadeddata = () => {
            canvas.width = videoSource.videoWidth;
            canvas.height = videoSource.videoHeight;
            videoSource.currentTime = 0.01;
        };

        videoSource.onseeked = () => {
            drawGPUFrame(videoSource);
        };
    } else {
        videoControls.style.display = 'none';
        videoSource.pause();
        originalImage = new Image();
        originalImage.onload = () => {
            canvas.width = originalImage.naturalWidth;
            canvas.height = originalImage.naturalHeight;
            drawGPUFrame(originalImage);
        };
        originalImage.src = url;
    }
}

// Smooth Video Loop
function videoPlaybackLoop() {
    if (!isPlayingVideo) return;
    drawGPUFrame(videoSource);
    vidSeek.value = (videoSource.currentTime / videoSource.duration) * 100;
    if (!videoSource.ended && !videoSource.paused) {
        requestAnimationFrame(videoPlaybackLoop);
    } else {
        isPlayingVideo = false;
        vidPlayBtn.textContent = '▶️';
    }
}

vidPlayBtn.onclick = () => {
    if (!isVideo) return;
    if (isPlayingVideo) {
        videoSource.pause();
        isPlayingVideo = false;
        vidPlayBtn.textContent = '▶️';
    } else {
        videoSource.play();
        isPlayingVideo = true;
        vidPlayBtn.textContent = '⏸️';
        requestAnimationFrame(videoPlaybackLoop);
    }
};

vidSeek.oninput = (e) => {
    if (!isVideo) return;
    videoSource.pause();
    isPlayingVideo = false;
    vidPlayBtn.textContent = '▶️';
    videoSource.currentTime = (e.target.value / 100) * videoSource.duration;
};

document.getElementById('upload-btn').onclick = () => document.getElementById('file-upload').click();
document.getElementById('file-upload').addEventListener('change', (e) => loadFile(e.target.files[0]));

// --- Video & Photo Downloader ---
async function exportCurrentFile() {
    if (!originalImage && !isVideo) return;
    const btn = document.getElementById(isBatchMode ? 'batch-download-btn' : 'download-btn');
    const originalText = btn.textContent;
    btn.textContent = '⏳';

    if (!isVideo) {
        drawGPUFrame(originalImage);
        const a = document.createElement('a');
        a.download = `photo_${Date.now()}.jpg`;
        a.href = canvas.toDataURL('image/jpeg', 0.95);
        a.click();
        btn.textContent = originalText;
    } else {
        // Full Real-time Video Mux & Recording
        videoSource.pause();
        videoSource.currentTime = 0;
        
        await new Promise(r => { videoSource.onseeked = r; });

        const stream = canvas.captureStream(30);
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/mp4' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `video_${Date.now()}.mp4`;
            a.click();
            btn.textContent = originalText;
        };

        mediaRecorder.start();
        videoSource.play();

        function recordRenderLoop() {
            if (videoSource.ended || videoSource.paused) {
                mediaRecorder.stop();
                return;
            }
            drawGPUFrame(videoSource);
            requestAnimationFrame(recordRenderLoop);
        }
        requestAnimationFrame(recordRenderLoop);
    }
}

document.getElementById('download-btn').onclick = () => exportCurrentFile();

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

// --- Presets ---
document.getElementById('copy-preset').onclick = () => { navigator.clipboard.writeText(JSON.stringify(settings)); alert('Preset copied! ✨'); };
document.getElementById('paste-preset').onclick = async () => { try { const text = await navigator.clipboard.readText(); settings = { ...settings, ...JSON.parse(text) }; updateUI(); } catch (e) { alert('Could not paste preset.'); }};
document.getElementById('save-preset').onclick = () => { const a = document.createElement('a'); a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(settings)); a.download = "preset.json"; a.click(); };
document.getElementById('load-preset-btn').onclick = () => document.getElementById('load-preset').click();
document.getElementById('load-preset').addEventListener('change', (e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (event) => { settings = { ...settings, ...JSON.parse(event.target.result) }; updateUI(); }; reader.readAsText(file); });
document.getElementById('reset-btn').onclick = () => { Object.keys(settings).forEach(key => settings[key] = 0); updateUI(); };

document.getElementById('panel-presets').classList.add('active');
