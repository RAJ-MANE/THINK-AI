document.addEventListener("DOMContentLoaded", () => {
    // --- STATE MANAGEMENT ---
    let initialQuestions = [], conversationHistory = [], allUserAnswers = [];
    let currentQuestionIndex = 0;
    let speechRecognition, isRecording = false, currentTranscript = "";
    let femaleVoice = null;
    let audioContext, analyser, audioDataArray, smoothedVolume = 0;
    
    // --- DOM ELEMENTS ---
    const ui = {
        uploadSection: document.getElementById('upload-section'),
        interviewContainer: document.getElementById('interview-container'),
        selectResumeBtn: document.getElementById('select-resume-btn'),
        resumeFile: document.getElementById('resume-file'),
        fileName: document.getElementById('file-name'),
        jobRoleSection: document.getElementById('job-role-section'),
        jobRoleInput: document.getElementById('job-role'),
        submitJobRoleBtn: document.getElementById('submit-job-role'),
        uploadLoader: document.getElementById('upload-loader'),
        uploadError: document.getElementById('upload-error'),
        startInterviewBtn: document.getElementById('start-interview-btn'),
        recordBtn: document.getElementById('record-btn'),
        questionText: document.getElementById('question'),
        responsesLog: document.getElementById('responses'),
        reportResults: document.getElementById('report-results'),
        reportContent: document.getElementById('report-content'),
        statusDot: document.getElementById('status-dot'),
        statusText: document.getElementById('status-text'),
        avatarCanvas: document.getElementById('avatar-canvas'),
        avatarContainer: document.getElementById('avatar-container'),
        video: document.getElementById('video'),
    };

    // --- 3D AVATAR (THREE.JS) ---
    let scene, camera, renderer, avatar;
    function initAvatar() {
        scene = new THREE.Scene();
        const rect = ui.avatarContainer.getBoundingClientRect();
        camera = new THREE.PerspectiveCamera(75, rect.width / rect.height, 0.1, 1000);
        renderer = new THREE.WebGLRenderer({ canvas: ui.avatarCanvas, antialias: true, alpha: true });
        renderer.setSize(rect.width, rect.height);
        renderer.setPixelRatio(window.devicePixelRatio);
        
        scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(5, 5, 5);
        scene.add(dirLight);
        
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.6, 64, 64), new THREE.MeshStandardMaterial({ color: 0xa78bfa, roughness: 0.4, metalness: 0.2 }));
        avatar = head;
        scene.add(avatar);
        camera.position.z = 2;
        animateAvatar();
    }
    function animateAvatar() {
        requestAnimationFrame(animateAvatar);
        if (analyser && avatar) {
            analyser.getByteFrequencyData(audioDataArray);
            const avg = audioDataArray.reduce((a, b) => a + b) / audioDataArray.length;
            const targetScale = 1 + (avg / 128.0) * 0.7;
            smoothedVolume += (targetScale - smoothedVolume) * 0.2; // Smoothing
            avatar.scale.set(smoothedVolume, smoothedVolume, smoothedVolume);
        }
        renderer.render(scene, camera);
    }

    // --- AUDIO & VIDEO SETUP ---
    function initAudioVisualizer(stream) {
        if (!stream.getAudioTracks().length) return;
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 64;
        audioDataArray = new Uint8Array(analyser.frequencyBinCount);
    }
    
    async function setupMedia() {
        try {
            await faceapi.nets.ssdMobilenetv1.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models');
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            ui.video.srcObject = stream;
            initAudioVisualizer(stream);
        } catch (err) {
            console.error("Error setting up media devices:", err);
            alert("Could not access camera/microphone. Please check permissions.");
        }
    }

    // --- SPEECH SYNTHESIS & RECOGNITION ---
    function setupSpeechSynthesis() {
        const setVoice = () => {
            const voices = window.speechSynthesis.getVoices();
            femaleVoice = voices.find(v => /female|zira|susan/i.test(v.name) && /en-US|en-GB/i.test(v.lang)) || voices.find(v => /en-US|en-GB/i.test(v.lang));
        };
        setVoice();
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = setVoice;
        }
    }
    
    function speak(text) {
        return new Promise(resolve => {
            updateStatus('status-speaking', 'AI is speaking...');
            const utterance = new SpeechSynthesisUtterance(text);
            if (femaleVoice) utterance.voice = femaleVoice;
            utterance.onend = () => {
                updateStatus('status-idle', 'Ready for your answer.');
                resolve();
            };
            speechSynthesis.speak(utterance);
        });
    }

    // --- INTERVIEW FLOW ---
    async function handleFileSelection() {
        const file = ui.resumeFile.files[0];
        if (!file) return;
        
        ui.fileName.textContent = `Selected: ${file.name}`;
        ui.selectResumeBtn.disabled = true;
        ui.jobRoleSection.classList.remove('hidden');
    }

    async function handleJobRoleSubmit() {
        const jobRole = ui.jobRoleInput.value.trim();
        const file = ui.resumeFile.files[0];
        if (!jobRole) {
            alert("Please enter a target job role.");
            return;
        }

        ui.uploadLoader.classList.remove('hidden');
        ui.jobRoleSection.classList.add('hidden');
        ui.uploadError.textContent = "";

        const formData = new FormData();
        formData.append('resume', file);
        formData.append('job_role', jobRole); // Add job role to the form data

        try {
            const response = await fetch('/api/analyze', { method: 'POST', body: formData });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to analyze resume.');

            initialQuestions = data.questions;
            ui.uploadSection.classList.add('hidden');
            ui.interviewContainer.classList.remove('hidden');
            initAvatar();
            setupMedia();
            setupSpeechSynthesis();

        } catch (error) {
            ui.uploadLoader.classList.add('hidden');
            ui.uploadError.textContent = error.message;
            ui.uploadError.classList.remove('hidden');
            ui.selectResumeBtn.disabled = false;
        }
    }

    async function askNextQuestion() {
        if (currentQuestionIndex >= initialQuestions.length) {
            await endInterview();
            return;
        }

        const question = initialQuestions[currentQuestionIndex];
        currentQuestionIndex++;

        conversationHistory.push({ role: 'model', parts: [{ text: question }] });
        ui.questionText.textContent = question;
        logToConversation('Improvyu', question);
        ui.recordBtn.disabled = true;
        await speak(question);
        ui.recordBtn.disabled = false;
    }

    function toggleRecording() {
        if (isRecording) {
            speechRecognition.stop();
        } else {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) { alert("Speech Recognition is not supported by this browser."); return; }
            
            speechRecognition = new SpeechRecognition();
            speechRecognition.lang = "en-US";
            speechRecognition.continuous = false;
            currentTranscript = "";

            speechRecognition.onstart = () => {
                isRecording = true;
                updateStatus('status-listening', 'Listening...');
                ui.recordBtn.querySelector('span').textContent = "Stop Recording";
                ui.recordBtn.classList.add('is-recording');
            };

            speechRecognition.onresult = event => {
                currentTranscript = Array.from(event.results).map(r => r[0].transcript).join('');
            };
            
            speechRecognition.onend = async () => {
                isRecording = false;
                updateStatus('status-processing', 'Processing...');
                ui.recordBtn.querySelector('span').textContent = "Record Answer";
                ui.recordBtn.classList.remove('is-recording');

                if (currentTranscript) {
                    allUserAnswers.push(currentTranscript);
                    conversationHistory.push({ role: 'user', parts: [{ text: currentTranscript }] });
                    logToConversation('You', currentTranscript);
                    
                    // Fetch a follow-up question
                    try {
                        const response = await fetch('/api/follow-up', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ history: conversationHistory })
                        });
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error);

                        const followUp = data.question;
                        if (followUp && followUp !== '[NEXT_QUESTION]') {
                            initialQuestions.splice(currentQuestionIndex, 0, followUp); // Insert follow-up
                        }
                    } catch (err) {
                        console.error("Follow-up fetch failed, proceeding to next question.", err);
                    }
                }
                setTimeout(askNextQuestion, 500); // Small delay before next question
            };
            speechRecognition.start();
        }
    }

    async function endInterview() {
        await speak("That concludes the interview. Generating your report now.");
        ui.recordBtn.disabled = true;
        ui.reportResults.classList.remove('hidden');
        ui.reportContent.innerHTML = '<div class="loader mx-auto"></div><p class="text-center mt-2">Evaluating...</p>';

        try {
            const response = await fetch('/api/evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answers: allUserAnswers })
            });
            const report = await response.json();
            if (!response.ok) throw new Error(report.error);
            
            ui.reportContent.innerHTML = `
                <p class="mb-2"><strong>Overall Score:</strong> ${report.overallScore || 'N/A'}</p>
                <p class="mb-2"><strong>Strengths:</strong> ${report.strengths || 'N/A'}</p>
                <p class="mb-2"><strong>Areas for Improvement:</strong> ${report.weaknesses || 'N/A'}</p>
                <p><strong>Suggestions:</strong> ${report.suggestion || 'N/A'}</p>
            `;
            updateStatus('status-idle', 'Report Complete.');
        } catch (err) {
            ui.reportContent.innerHTML = `<p class="text-red-400">Error: Could not retrieve report. ${err.message}</p>`;
        }
    }

    // --- UI HELPERS & EVENT LISTENERS ---
    function updateStatus(status, text) {
        ui.statusDot.className = `status-dot status-${status}`;
        ui.statusText.textContent = text;
    }
    function logToConversation(role, text) {
        const p = document.createElement('p');
        const color = role === 'You' ? 'text-purple-300' : 'text-cyan-300';
        p.innerHTML = `<strong class="${color}">${role}:</strong> ${text}`;
        ui.responsesLog.appendChild(p);
        ui.responsesLog.scrollTop = ui.responsesLog.scrollHeight;
    }

    ui.selectResumeBtn.addEventListener('click', () => ui.resumeFile.click());
    ui.resumeFile.addEventListener('change', handleFileSelection);
    ui.submitJobRoleBtn.addEventListener('click', handleJobRoleSubmit);
    ui.startInterviewBtn.addEventListener('click', () => {
        ui.startInterviewBtn.disabled = true;
        askNextQuestion();
    });
    ui.recordBtn.addEventListener('click', toggleRecording);
});