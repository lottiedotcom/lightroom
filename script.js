const glCanvas = document.getElementById('gl-canvas');
const gl = glCanvas.getContext('webgl', { preserveDrawingBuffer: true });

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
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, curveHigh: 0, curveLight: 0, curveDark: 0, curveShadow: 0, whites: 0, blacks: 0,
    temp: 0, tint: 0, vibrance: 0, saturation: 0,
    pickedH: -1, pickedS: 0, pickedL: 0, pointHue: 0, pointSat: 0, pointLum: 0,
    redH: 0, redS: 0, redL: 0, orgH: 0, orgS: 0, orgL: 0, yelH: 0, yelS: 0, yelL: 0,
    grnH: 0, grnS: 0, grnL: 0, aquH: 0, aquS: 0, aquL: 0, bluH: 0, bluS: 0, bluL: 0,
    purH: 0, purS: 0, purL: 0, magH: 0, magS: 0, magL: 0,
    gradShadH: 0, gradShadS: 0, gradMidH: 0, gradMidS: 0, gradHighH: 0, gradHighS: 0,
    texture: 0, clarity: 0, dehaze: 0, blur: 0, vignette: 0, sharpen: 0, noiseRed: 0, grain: 0
};

// --- WebGL Shader Engine (Full GPU Color Pipeline) ---
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
    varying vec2 v_texCoord;
    uniform sampler2D u_image;
    uniform vec2 u_texSize;

    // Light & Tone Controls
    uniform float u_exposure, u_contrast, u_highlights, u_shadows, u_whites, u_blacks;
    uniform float u_temp, u_tint, u_vibrance, u_saturation;
    uniform vec4 u_curves; // High, Light, Dark, Shadow

    // 8-Channel HSL & Point Color
    uniform vec3 u_hslRed, u_hslOrg, u_hslYel, u_hslGrn, u_hslAqu, u_hslBlu, u_hslPur, u_hslMag;
    uniform vec3 u_pointCol, u_pointShift; 

    // Color Grading
    uniform vec3 u_gradShad, u_gradMid, u_gradHigh; 

    // Presence & Effects
    uniform float u_vignette, u_grain, u_time, u_sharpen, u_clarity, u_texture, u_blur, u_dehaze;

    // Branchless, High-Precision HSL to RGB
    vec3 hsl2rgb(vec3 c) {
        vec3 rgb = clamp(abs(mod(c.x / 60.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
    }

    // High-Precision RGB to HSL
    vec3 rgb2hsl(vec3 c) {
        float maxC = max(max(c.r, c.g), c.b);
        float minC = min(min(c.r, c.g), c.b);
        float d = maxC - minC;
        float l = (maxC + minC) * 0.5;
        if (d == 0.0) return vec3(0.0, 0.0, l);
        float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
        float h = 0.0;
        if (maxC == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
        else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
        else h = (c.r - c.g) / d + 4.0;
        return vec3(h * 60.0, s, l);
    }

    float rand(vec2 co) { 
        return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453); 
    }

    vec3 applyGrading(float h, float s, float w) {
        if (s <= 0.0) return vec3(0.0);
        vec3 c = hsl2rgb(vec3(h, s / 100.0, 0.5));
        return (c - 0.5) * w;
    }

    void main() {
        vec4 baseColor = texture2D(u_image, v_texCoord);

        // 1. Skin Blur
        if (u_blur > 0.0) {
            vec2 off = (u_blur * 2.0) / u_texSize;
            baseColor += texture2D(u_image, v_texCoord + vec2(off.x, 0.0));
            baseColor += texture2D(u_image, v_texCoord - vec2(off.x, 0.0));
            baseColor += texture2D(u_image, v_texCoord + vec2(0.0, off.y));
            baseColor += texture2D(u_image, v_texCoord - vec2(0.0, off.y));
            baseColor += texture2D(u_image, v_texCoord + vec2(off.x, off.y));
            baseColor += texture2D(u_image, v_texCoord - vec2(off.x, off.y));
            baseColor += texture2D(u_image, v_texCoord + vec2(-off.x, off.y));
            baseColor += texture2D(u_image, v_texCoord - vec2(-off.x, off.y));
            baseColor /= 9.0;
        }

        vec3 rgb = baseColor.rgb;

        // 2. Dehaze
        if (u_dehaze != 0.0) {
            float dAmt = u_dehaze / 100.0;
            float darkFactor = 1.0 - ((rgb.r + rgb.g + rgb.b) / 3.0);
            rgb.r -= dAmt * 0.15 * darkFactor;
            rgb.g -= dAmt * 0.20 * darkFactor;
            rgb.b -= dAmt * 0.30 * darkFactor;
            rgb = clamp(rgb, 0.0, 1.0);
        }

        // 3. Sharpen, Texture & Clarity
        float effectiveSharpen = u_sharpen + (u_clarity * 0.6) + (u_texture * 0.4);
        if (effectiveSharpen > 0.0) {
            float amt = effectiveSharpen / 200.0;
            vec2 dx = vec2(1.0 / u_texSize.x, 0.0);
            vec2 dy = vec2(0.0, 1.0 / u_texSize.y);
            vec3 c1 = texture2D(u_image, v_texCoord - dx).rgb;
            vec3 c2 = texture2D(u_image, v_texCoord + dx).rgb;
            vec3 c3 = texture2D(u_image, v_texCoord - dy).rgb;
            vec3 c4 = texture2D(u_image, v_texCoord + dy).rgb;
            rgb = rgb * (1.0 + amt * 4.0) - (c1 + c2 + c3 + c4) * amt;
        }

        // 4. Exposure & White Balance
        rgb *= (1.0 + (u_exposure / 100.0));
        rgb.r += u_temp * 0.0035;
        rgb.b -= u_temp * 0.0035;
        rgb.g += u_tint * 0.0035;
        rgb = clamp(rgb, 0.0, 1.0);

        // 5. 8-Channel HSL & Selective Color
        vec3 hsl = rgb2hsl(rgb);
        float h = hsl.x;
        vec3 hMod = vec3(0.0);

        if (h > 345.0 || h <= 15.0) hMod = u_hslRed;
        else if (h > 15.0 && h <= 45.0) hMod = u_hslOrg;
        else if (h > 45.0 && h <= 75.0) hMod = u_hslYel;
        else if (h > 75.0 && h <= 150.0) hMod = u_hslGrn;
        else if (h > 150.0 && h <= 200.0) hMod = u_hslAqu;
        else if (h > 200.0 && h <= 260.0) hMod = u_hslBlu;
        else if (h > 260.0 && h <= 290.0) hMod = u_hslPur;
        else if (h > 290.0 && h <= 345.0) hMod = u_hslMag;

        // Point Color Eyedropper Shift
        if (u_pointCol.x >= 0.0) {
            float hDiff = min(abs(h - u_pointCol.x), 360.0 - abs(h - u_pointCol.x));
            if (hDiff < 35.0) {
                hMod += u_pointShift * (1.0 - (hDiff / 35.0));
            }
        }

        if (hMod.x != 0.0 || hMod.y != 0.0 || hMod.z != 0.0) {
            hsl.x = mod(hsl.x + hMod.x + 360.0, 360.0);
            hsl.y = clamp(hsl.y + (hMod.y / 100.0), 0.0, 1.0);
            hsl.z = clamp(hsl.z + (hMod.z / 100.0), 0.0, 1.0);
            rgb = hsl2rgb(hsl);
        }

        // 6. Color Grading Wheels
        float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
        if (u_gradShad.y > 0.0 && lum < 0.5) rgb += applyGrading(u_gradShad.x, u_gradShad.y, (0.5 - lum) / 0.5);
        if (u_gradMid.y > 0.0) rgb += applyGrading(u_gradMid.x, u_gradMid.y, 1.0 - (abs(lum - 0.5) / 0.5));
        if (u_gradHigh.y > 0.0 && lum >= 0.5) rgb += applyGrading(u_gradHigh.x, u_gradHigh.y, (lum - 0.5) / 0.5);

        // 7. Parametric Tone Curves
        float cLum = lum;
        if (lum > 0.75) cLum += (u_curves.x / 100.0) * ((lum - 0.75) / 0.25);
        else if (lum > 0.5) cLum += (u_curves.y / 100.0) * ((lum - 0.5) / 0.25);
        else if (lum > 0.25) cLum += (u_curves.z / 100.0) * ((0.5 - lum) / 0.25);
        else cLum += (u_curves.w / 100.0) * ((0.25 - lum) / 0.25);
        
        rgb *= (lum <= 0.001) ? 0.0 : (clamp(cLum, 0.0, 1.0) / lum);

        // 8. Basic Tones & Clipping
        lum = dot(rgb, vec3(0.299, 0.587, 0.114));
        if (lum > 0.5) rgb += (u_highlights / 100.0) * ((lum - 0.5) / 0.5);
        else rgb += (u_shadows / 100.0) * ((0.5 - lum) / 0.5);

        rgb += (u_whites / 100.0);
        rgb -= (u_blacks / 100.0);

        // 9. Saturation & Vibrance
        float maxC = max(max(rgb.r, rgb.g), rgb.b);
        float minC = min(min(rgb.r, rgb.g), rgb.b);
        float satMod = (u_saturation / 100.0) + ((u_vibrance / 100.0) * (1.0 - (maxC - minC)));
        rgb = mix(vec3(lum), rgb, 1.0 + satMod);

        // 10. Contrast (Full Dynamic Range)
        float cFactor = (259.0 * (u_contrast + 255.0)) / (255.0 * (259.0 - u_contrast));
        rgb = (rgb - 0.5) * cFactor + 0.5;

        // 11. Vignette
        if (u_vignette != 0.0) {
            float dist = distance(v_texCoord, vec2(0.5, 0.5));
            float vig = 1.0 + (u_vignette / 100.0) * pow(dist * 1.414, 2.0);
            rgb *= clamp(vig, 0.0, 2.0);
        }

        // 12. Grain
        if (u_grain > 0.0) {
            rgb += (rand(v_texCoord + u_time) - 0.5) * (u_grain / 100.0);
        }

        gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), baseColor.a);
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

const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);

const texCoordBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,1, 1,1, 0,0, 0,0, 1,1, 1,0]), gl.STATIC_DRAW);

const posLocation = gl.getAttribLocation(program, "a_position");
const texLocation = gl.getAttribLocation(program, "a_texCoord");

gl.enableVertexAttribArray(posLocation);
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);

gl.enableVertexAttribArray(texLocation);
gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
gl.vertexAttribPointer(texLocation, 2, gl.FLOAT, false, 0, 0);

const glTexture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, glTexture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

function getLoc(name) { 
    return gl.getUniformLocation(program, name); 
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
    requestAnimationFrame(renderCurrent);
}

function renderCurrent() {
    if (isVideo && videoSource.readyState >= 2) {
        drawGPUFrame(videoSource, previewWidth, previewHeight);
    } else if (originalImage) {
        drawGPUFrame(originalImage, previewWidth, previewHeight);
    }
}

sliders.forEach(slider => {
    slider.addEventListener('input', (e) => {
        if (slider.id === 'vid-seek') return;
        const val = parseFloat(e.target.value);
        settings[e.target.id] = val;
        const numInp = document.getElementById(`num-${e.target.id}`);
        if (numInp) numInp.value = val;
        requestAnimationFrame(renderCurrent);
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
        requestAnimationFrame(renderCurrent);
    });
});

// --- Direct GPU Frame Transfer ---
function drawGPUFrame(sourceElement, width, height) {
    if (!sourceElement) return;

    glCanvas.width = width; 
    glCanvas.height = height;
    gl.viewport(0, 0, width, height);

    gl.bindTexture(gl.TEXTURE_2D, glTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceElement);

    // Uniform Bindings
    gl.uniform2f(getLoc("u_texSize"), width, height);
    gl.uniform1f(getLoc("u_exposure"), settings.exposure);
    gl.uniform1f(getLoc("u_contrast"), settings.contrast);
    gl.uniform1f(getLoc("u_highlights"), settings.highlights);
    gl.uniform1f(getLoc("u_shadows"), settings.shadows);
    gl.uniform1f(getLoc("u_whites"), settings.whites);
    gl.uniform1f(getLoc("u_blacks"), settings.blacks);
    gl.uniform1f(getLoc("u_temp"), settings.temp);
    gl.uniform1f(getLoc("u_tint"), settings.tint);
    gl.uniform1f(getLoc("u_vibrance"), settings.vibrance);
    gl.uniform1f(getLoc("u_saturation"), settings.saturation);
    gl.uniform1f(getLoc("u_vignette"), settings.vignette);
    gl.uniform1f(getLoc("u_grain"), settings.grain);
    gl.uniform1f(getLoc("u_sharpen"), settings.sharpen);
    gl.uniform1f(getLoc("u_clarity"), settings.clarity);
    gl.uniform1f(getLoc("u_texture"), settings.texture);
    
    // Skin Blur & Dehaze
    let bRad = settings.blur > 0 ? 3.0 : (settings.noiseRed / 25.0);
    gl.uniform1f(getLoc("u_blur"), settings.blur > 0 ? bRad * (settings.blur / 100.0) : (settings.noiseRed > 0 ? bRad : 0.0));
    gl.uniform1f(getLoc("u_dehaze"), settings.dehaze);
    gl.uniform1f(getLoc("u_time"), Math.random());
    
    gl.uniform4f(getLoc("u_curves"), settings.curveHigh, settings.curveLight, settings.curveDark, settings.curveShadow);
    
    // 8 Channels
    gl.uniform3f(getLoc("u_hslRed"), settings.redH, settings.redS, settings.redL);
    gl.uniform3f(getLoc("u_hslOrg"), settings.orgH, settings.orgS, settings.orgL);
    gl.uniform3f(getLoc("u_hslYel"), settings.yelH, settings.yelS, settings.yelL);
    gl.uniform3f(getLoc("u_hslGrn"), settings.grnH, settings.grnS, settings.grnL);
    gl.uniform3f(getLoc("u_hslAqu"), settings.aquH, settings.aquS, settings.aquL);
    gl.uniform3f(getLoc("u_hslBlu"), settings.bluH, settings.bluS, settings.bluL);
    gl.uniform3f(getLoc("u_hslPur"), settings.purH, settings.purS, settings.purL);
    gl.uniform3f(getLoc("u_hslMag"), settings.magH, settings.magS, settings.magL);
    
    gl.uniform3f(getLoc("u_pointCol"), settings.pickedH, settings.pickedS, settings.pickedL);
    gl.uniform3f(getLoc("u_pointShift"), settings.pointHue, settings.pointSat, settings.pointLum);
    
    gl.uniform3f(getLoc("u_gradShad"), settings.gradShadH, settings.gradShadS, 0);
    gl.uniform3f(getLoc("u_gradMid"), settings.gradMidH, settings.gradMidS, 0);
    gl.uniform3f(getLoc("u_gradHigh"), settings.gradHighH, settings.gradHighS, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// --- File Handling ---
function loadFile(file) {
    if (!file) return;
    
    isVideo = file.type.startsWith('video/');
    const url = URL.createObjectURL(file);
    const MAX_PREVIEW_SIZE = isVideo ? 600 : 800;
    
    glCanvas.style.display = 'block';
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
            const scale = Math.min(1, MAX_PREVIEW_SIZE / Math.max(videoSource.videoWidth, videoSource.videoHeight));
            previewWidth = Math.floor(videoSource.videoWidth * scale);
            previewHeight = Math.floor(videoSource.videoHeight * scale);
            videoSource.currentTime = 0.05; 
        };

        videoSource.onseeked = () => requestAnimationFrame(renderCurrent);
    } else {
        videoControls.style.display = 'none';
        videoSource.pause();
        originalImage = new Image();
        originalImage.onload = () => {
            const scale = Math.min(1, MAX_PREVIEW_SIZE / Math.max(originalImage.naturalWidth, originalImage.naturalHeight));
            previewWidth = Math.floor(originalImage.naturalWidth * scale);
            previewHeight = Math.floor(originalImage.naturalHeight * scale);
            requestAnimationFrame(renderCurrent);
        };
        originalImage.src = url;
    }
}

// Video Scrubber & Playback
function videoPlaybackLoop() {
    if (!isPlayingVideo) return;
    drawGPUFrame(videoSource, previewWidth, previewHeight);
    vidSeek.value = (videoSource.currentTime / videoSource.duration) * 100;
    
    if (!videoSource.ended && !videoSource.paused) {
        if ('requestVideoFrameCallback' in videoSource) {
            videoSource.requestVideoFrameCallback(videoPlaybackLoop);
        } else {
            requestAnimationFrame(videoPlaybackLoop);
        }
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
        if ('requestVideoFrameCallback' in videoSource) {
            videoSource.requestVideoFrameCallback(videoPlaybackLoop);
        } else {
            requestAnimationFrame(videoPlaybackLoop);
        }
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

// --- Complete Full Video Downloader ---
async function exportCurrentFile() {
    if (!originalImage && !isVideo) return;
    const btn = document.getElementById(isBatchMode ? 'batch-download-btn' : 'download-btn');
    const originalText = btn.textContent;
    btn.textContent = '⏳';

    if (!isVideo) {
        const width = originalImage.naturalWidth, height = originalImage.naturalHeight;
        drawGPUFrame(originalImage, width, height);
        
        const a = document.createElement('a');
        a.download = `photo_${Date.now()}.jpg`;
        a.href = glCanvas.toDataURL('image/jpeg', 1.0);
        a.click();
        
        drawGPUFrame(originalImage, previewWidth, previewHeight);
        btn.textContent = originalText;
    } else {
        try {
            videoSource.pause();
            
            // Reliable Rewind Promise with Timeout Fallback
            await new Promise(resolve => {
                let resolved = false;
                const done = () => {
                    if (!resolved) {
                        resolved = true;
                        videoSource.onseeked = null;
                        resolve();
                    }
                };
                videoSource.onseeked = done;
                videoSource.currentTime = 0;
                setTimeout(done, 350);
            });

            // Target Full Native Resolution
            const scale = Math.min(1, 1920 / Math.max(videoSource.videoWidth, videoSource.videoHeight));
            const eWidth = Math.floor(videoSource.videoWidth * scale);
            const eHeight = Math.floor(videoSource.videoHeight * scale);

            drawGPUFrame(videoSource, eWidth, eHeight);

            const stream = glCanvas.captureStream(30);
            
            // Audio Stream
            try {
                const audioStream = videoSource.captureStream ? videoSource.captureStream() : (videoSource.mozCaptureStream ? videoSource.mozCaptureStream() : null);
                if (audioStream && audioStream.getAudioTracks().length > 0) {
                    stream.addTrack(audioStream.getAudioTracks()[0]);
                }
            } catch (e) {
                console.log('Audio track skipped:', e);
            }

            recordedChunks = [];
            
            let options = { videoBitsPerSecond: 12000000 };
            let ext = 'mp4';
            
            if (MediaRecorder.isTypeSupported('video/mp4')) {
                options.mimeType = 'video/mp4';
            } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
                options.mimeType = 'video/webm;codecs=vp9'; 
                ext = 'webm';
            } else {
                options.mimeType = 'video/webm'; 
                ext = 'webm';
            }

            mediaRecorder = new MediaRecorder(stream, options);
            mediaRecorder.ondataavailable = (e) => { 
                if (e.data && e.data.size > 0) recordedChunks.push(e.data); 
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `video_grade_${Date.now()}.${ext}`;
                a.click();
                btn.textContent = originalText;
                drawGPUFrame(videoSource, previewWidth, previewHeight);
            };

            // Hook completion directly to video finish
            videoSource.onended = () => {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                }
            };

            mediaRecorder.start(250);
            await videoSource.play();

            function recordRenderLoop() {
                if (videoSource.ended || videoSource.paused) {
                    if (videoSource.ended && mediaRecorder && mediaRecorder.state === 'recording') {
                        mediaRecorder.stop();
                    }
                    return;
                }
                drawGPUFrame(videoSource, eWidth, eHeight);
                requestAnimationFrame(recordRenderLoop);
            }
            requestAnimationFrame(recordRenderLoop);
        } catch (err) {
            alert("Export error: " + err.message);
            btn.textContent = originalText;
        }
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

const pickCanvas = document.createElement('canvas'); 
pickCanvas.width = 1; 
pickCanvas.height = 1;
const pickCtx = pickCanvas.getContext('2d', { willReadFrequently: true });

glCanvas.addEventListener('click', (e) => {
    if (!isPicking) return;
    const rect = glCanvas.getBoundingClientRect();
    
    pickCtx.drawImage(isVideo ? videoSource : originalImage, 
        (e.clientX - rect.left) * ((isVideo ? videoSource.videoWidth : originalImage.naturalWidth) / rect.width), 
        (e.clientY - rect.top) * ((isVideo ? videoSource.videoHeight : originalImage.naturalHeight) / rect.height), 
        1, 1, 0, 0, 1, 1);
        
    const pixel = pickCtx.getImageData(0, 0, 1, 1).data;
    const maxC = Math.max(pixel[0], pixel[1], pixel[2]) / 255;
    const minC = Math.min(pixel[0], pixel[1], pixel[2]) / 255;
    const d = maxC - minC;
    let h = 0;
    
    if (d !== 0) {
        if (maxC === pixel[0]/255) h = ((pixel[1]/255 - pixel[2]/255) / d) + (pixel[1]/255 < pixel[2]/255 ? 6 : 0);
        else if (maxC === pixel[1]/255) h = ((pixel[2]/255 - pixel[0]/255) / d) + 2;
        else h = ((pixel[0]/255 - pixel[1]/255) / d) + 4;
        h /= 6;
    }
    
    settings.pickedH = h * 360; 
    settings.pickedS = 0; 
    settings.pickedL = 0;
    pickedColorDisplay.style.background = `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
    
    isPicking = false;
    pickerBtn.textContent = "Activate Eyedropper 💉";
    pickerTarget.style.display = "none";
    
    requestAnimationFrame(renderCurrent);
});

// Presets & History
document.getElementById('copy-preset').onclick = () => { 
    navigator.clipboard.writeText(JSON.stringify(settings)); 
    alert('Preset copied! ✨'); 
};
document.getElementById('paste-preset').onclick = async () => { 
    try { 
        const text = await navigator.clipboard.readText(); 
        settings = { ...settings, ...JSON.parse(text) }; 
        updateUI(); 
    } catch (e) { 
        alert('Could not paste preset.'); 
    }
};
document.getElementById('save-preset').onclick = () => { 
    const a = document.createElement('a'); 
    a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(settings)); 
    a.download = "preset.json"; 
    a.click(); 
};
document.getElementById('load-preset-btn').onclick = () => document.getElementById('load-preset').click();
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
    Object.keys(settings).forEach(key => settings[key] = (key === 'pickedH' ? -1 : 0)); 
    updateUI(); 
};

let history = []; 
let historyIndex = -1;
function saveHistory() { 
    history = history.slice(0, historyIndex + 1); 
    history.push(JSON.parse(JSON.stringify(settings))); 
    historyIndex++; 
}
saveHistory();

document.getElementById('panel-presets').classList.add('active');
