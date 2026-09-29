/* ===== 考研知识点收录助手 - 核心逻辑 ===== */

// ===== 常量配置 =====
const STORAGE_KEY = 'kaoyan_knowledge_points';
const SUB_SUBJECT_KEY = 'kaoyan_sub_subjects';  // 专业课子科目
const SIMILARITY_THRESHOLD = 0.55;  // 相似度阈值
const RECENT_DAYS = 30;             // 近期查重天数范围
const IMG_MAX_WIDTH = 800;          // 图片压缩后最大宽度
const IMG_QUALITY = 0.6;            // 图片压缩质量 (0-1)

// ===== 数据模型 =====
class KnowledgeStore {
    constructor() {
        this.data = this.load();
    }

    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.error('数据加载失败:', e);
            return [];
        }
    }

    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        } catch (e) {
            console.error('数据保存失败:', e);
            const used = getStorageUsage();
            showToast(`存储失败！已用 ${used.usedKB}KB / ${used.totalKB}KB，请导出备份后清理旧数据`, 'error');
        }
    }

    add(item) {
        this.data.unshift(item);
        this.save();
    }

    remove(id) {
        this.data = this.data.filter(item => item.id !== id);
        this.save();
    }

    getAll() {
        return this.data;
    }

    getById(id) {
        return this.data.find(item => item.id === id);
    }

    clear() {
        this.data = [];
        this.save();
    }

    importData(items) {
        this.data = [...items, ...this.data];
        this.save();
    }
}

// ===== 相似度检测引擎 =====
class SimilarityEngine {
    // 文本预处理：去除空白、标点、转小写
    static normalize(text) {
        return text
            .replace(/\s+/g, '')
            .replace(/[，。！？、；：“”''（）【】《》\.,!?;:'"()\[\]{}<>\/\\@#$%^&*~`+=\-_|]/g, '')
            .toLowerCase();
    }

    // 生成字符 bigram 集合
    static getBigrams(text) {
        const normalized = this.normalize(text);
        const bigrams = new Set();
        if (normalized.length < 2) {
            if (normalized.length === 1) bigrams.add(normalized);
            return bigrams;
        }
        for (let i = 0; i < normalized.length - 1; i++) {
            bigrams.add(normalized.substring(i, i + 2));
        }
        return bigrams;
    }

    // 计算 Jaccard 相似度
    static jaccardSimilarity(setA, setB) {
        if (setA.size === 0 && setB.size === 0) return 1;
        if (setA.size === 0 || setB.size === 0) return 0;

        let intersectionCount = 0;
        for (const item of setA) {
            if (setB.has(item)) intersectionCount++;
        }

        const unionCount = setA.size + setB.size - intersectionCount;
        return intersectionCount / unionCount;
    }

    // 字符频率向量（用于余弦相似度）
    static getCharFrequency(text) {
        const normalized = this.normalize(text);
        const freq = {};
        for (const ch of normalized) {
            freq[ch] = (freq[ch] || 0) + 1;
        }
        return freq;
    }

    // 余弦相似度（基于字符频率，对语序不敏感）
    static cosineSimilarity(textA, textB) {
        const freqA = this.getCharFrequency(textA);
        const freqB = this.getCharFrequency(textB);

        // 收集所有字符
        const allChars = new Set([...Object.keys(freqA), ...Object.keys(freqB)]);
        if (allChars.size === 0) return 1;

        let dotProduct = 0;
        let magA = 0;
        let magB = 0;

        for (const ch of allChars) {
            const a = freqA[ch] || 0;
            const b = freqB[ch] || 0;
            dotProduct += a * b;
            magA += a * a;
            magB += b * b;
        }

        if (magA === 0 || magB === 0) return 0;
        return dotProduct / (Math.sqrt(magA) * Math.sqrt(magB));
    }

    // 计算子串包含关系
    static substringMatch(textA, textB) {
        const a = this.normalize(textA);
        const b = this.normalize(textB);
        if (a.length === 0 || b.length === 0) return 0;

        const shorter = a.length < b.length ? a : b;
        const longer = a.length >= b.length ? a : b;

        if (longer.includes(shorter)) {
            return shorter.length / longer.length;
        }
        return 0;
    }

    // 综合相似度计算（三种算法取最高分）
    static calculateSimilarity(textA, textB) {
        const bigramsA = this.getBigrams(textA);
        const bigramsB = this.getBigrams(textB);
        const jaccard = this.jaccardSimilarity(bigramsA, bigramsB);
        const substring = this.substringMatch(textA, textB);
        const cosine = this.cosineSimilarity(textA, textB);

        // 取三种算法中较高的分数
        return Math.max(jaccard, substring * 0.9, cosine);
    }

    // 查找重复/相似知识点
    static findDuplicates(newContent, store, recentDays = RECENT_DAYS) {
        const now = Date.now();
        const recentThreshold = now - recentDays * 24 * 60 * 60 * 1000;
        const results = [];

        for (const item of store.getAll()) {
            // 只检查近期内的记录
            if (item.timestamp < recentThreshold) continue;
            if (!item.content || !newContent) continue;

            const similarity = this.calculateSimilarity(newContent, item.content);

            if (similarity >= SIMILARITY_THRESHOLD) {
                results.push({
                    item: item,
                    similarity: similarity
                });
            }
        }

        // 按相似度降序排列
        results.sort((a, b) => b.similarity - a.similarity);
        return results;
    }

    // 统计某个知识点被重复收录的次数
    static countOccurrences(content, store) {
        if (!content) return 1;
        let count = 0;
        for (const item of store.getAll()) {
            if (!item.content) continue;
            const similarity = this.calculateSimilarity(content, item.content);
            if (similarity >= SIMILARITY_THRESHOLD) {
                count++;
            }
        }
        return count;
    }
}

// ===== 工具函数 =====
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}年${month}月${day}日 ${hour}:${minute}`;
}

function getSubjectClass(subject) {
    const map = {
        '政治': 'politics',
        '英语': 'english',
        '数学': 'math',
        '专业课': 'professional',
        '其他': 'other'
    };
    return map[subject] || 'other';
}

// ===== 存储用量计算 =====
function getStorageUsage() {
    let usedBytes = 0;
    for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
            usedBytes += localStorage[key].length * 2; // UTF-16 每字符2字节
        }
    }
    // localStorage 通常为 5MB
    const totalBytes = 5 * 1024 * 1024;
    return {
        usedKB: Math.round(usedBytes / 1024),
        totalKB: Math.round(totalBytes / 1024),
        usedMB: (usedBytes / (1024 * 1024)).toFixed(2),
        totalMB: '5.00'
    };
}

// ===== 图片压缩 =====
function compressImage(dataUrl, maxWidth = IMG_MAX_WIDTH, quality = IMG_QUALITY) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            // 计算缩放后的尺寸
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
            }

            // 用 Canvas 压缩
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // 导出为压缩后的 JPEG
            const compressed = canvas.toDataURL('image/jpeg', quality);

            // 计算压缩率
            const savedPercent = Math.round((1 - compressed.length / dataUrl.length) * 100);
            console.log(`图片压缩: ${(dataUrl.length / 1024).toFixed(1)}KB → ${(compressed.length / 1024).toFixed(1)}KB (节省${savedPercent}%)`);

            resolve(compressed);
        };
        img.onerror = () => {
            // 压缩失败时返回原图
            resolve(dataUrl);
        };
        img.src = dataUrl;
    });
}

// ===== Toast 提示 =====
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// ===== 语音输入模块 =====
class VoiceInput {
    constructor() {
        this.recognition = null;
        this.isRecording = false;
        this.isSupported = false;
        this.restartTimer = null;       // 重启定时器
        this.restartPending = false;     // 是否正在等待重启
        this.onResult = null;   // 回调：收到识别结果
        this.onStart = null;    // 回调：开始录音
        this.onStop = null;     // 回调：停止录音
        this.onError = null;    // 回调：出错
        this.initRecognition();
    }

    initRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.isSupported = false;
            return;
        }

        this.isSupported = true;
        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'zh-CN';
        this.recognition.continuous = true;       // 持续识别
        this.recognition.interimResults = true;    // 显示中间结果
        this.recognition.maxAlternatives = 1;

        this.recognition.onresult = (event) => {
            let finalTranscript = '';
            let interim = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interim += transcript;
                }
            }

            if (this.onResult) {
                this.onResult(finalTranscript, interim);
            }
        };

        this.recognition.onend = () => {
            // 清除重启定时器
            if (this.restartTimer) {
                clearTimeout(this.restartTimer);
                this.restartTimer = null;
            }

            if (this.isRecording && !this.restartPending) {
                // 延迟重启，给 API 足够时间重置内部状态
                this.restartPending = true;
                this.restartTimer = setTimeout(() => {
                    this.restartPending = false;
                    if (this.isRecording) {
                        try {
                            this.recognition.start();
                        } catch (e) {
                            console.warn('语音识别重启失败:', e);
                            // 重启失败，强制停止
                            this.isRecording = false;
                            if (this.onStop) this.onStop();
                        }
                    }
                }, 300);
            } else if (!this.isRecording) {
                if (this.onStop) this.onStop();
            }
        };

        this.recognition.onerror = (event) => {
            console.error('语音识别错误:', event.error);
            if (event.error === 'not-allowed') {
                if (this.onError) this.onError('麦克风权限被拒绝，请在浏览器设置中允许使用麦克风');
            } else if (event.error === 'no-speech') {
                // 没有检测到语音，忽略（自动继续监听）
            } else if (event.error === 'network') {
                if (this.onError) this.onError('网络错误，语音识别需要联网');
            } else {
                if (this.onError) this.onError(`语音识别出错：${event.error}`);
            }
        };
    }

    startRecording() {
        if (!this.isSupported || this.isRecording) return;
        // 清除可能存在的重启定时器
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        this.restartPending = false;
        try {
            this.recognition.start();
            this.isRecording = true;
            if (this.onStart) this.onStart();
        } catch (e) {
            console.error('启动语音识别失败:', e);
            // 如果 start 失败，可能是上一次会话还没完全结束，等 500ms 后重试
            setTimeout(() => {
                if (!this.isRecording) {
                    try {
                        this.recognition.start();
                        this.isRecording = true;
                        if (this.onStart) this.onStart();
                    } catch (e2) {
                        console.error('重试启动也失败:', e2);
                    }
                }
            }, 500);
        }
    }

    stopRecording() {
        if (!this.isRecording && !this.restartPending) return;
        // 清除重启定时器，防止 onend 后自动重启
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        this.isRecording = false;
        this.restartPending = false;
        try {
            this.recognition.stop();
        } catch (e) {
            // ignore
        }
        if (this.onStop) this.onStop();
    }

    toggle() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }
}

// ===== AI 客户端 =====
const AI_CONFIG_KEY = 'kaoyan_ai_config';

class AIClient {
    constructor() {
        this.config = this.loadConfig();
    }

    loadConfig() {
        try {
            const raw = localStorage.getItem(AI_CONFIG_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return { baseUrl: '', apiKey: '', model: '' };
    }

    saveConfig(config) {
        this.config = config;
        localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
    }

    isConfigured() {
        return this.config.baseUrl && this.config.apiKey && this.config.model;
    }

    // 发送请求到 AI API（OpenAI 兼容格式）
    async chat(messages, { temperature = 0.7, maxTokens = 1024 } = {}) {
        if (!this.isConfigured()) {
            throw new Error('请先在 AI 设置中配置 API 地址、密钥和模型');
        }

        const url = this.config.baseUrl.replace(/\/+$/, '') + '/chat/completions';
        const isKimi = this.config.model.startsWith('kimi-');

        const body = {
            model: this.config.model,
            messages: messages
        };
        // Kimi 模型不允许自定义 temperature，只用默认值 1
        if (!isKimi) {
            body.temperature = temperature;
        }
        // Kimi 使用 max_completion_tokens，其他用 max_tokens
        if (isKimi) {
            body.max_completion_tokens = maxTokens;
        } else {
            body.max_tokens = maxTokens;
        }

        console.log('AI 请求:', { url, model: this.config.model, msgCount: messages.length });

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`API 请求失败 (${response.status})${errText ? ': ' + errText : ''}`);
        }

        const data = await response.json();
        console.log('AI 响应:', JSON.stringify(data).substring(0, 500));

        // 兼容多种返回格式
        const content = data.choices?.[0]?.message?.content
            || data.choices?.[0]?.delta?.content
            || data.output?.text
            || '';

        if (!content) {
            throw new Error('AI 返回了空内容，请检查模型是否支持该请求格式');
        }
        return content;
    }

    // 讲解知识点
    async explainKnowledge(item) {
        const messages = [
            {
                role: 'system',
                content: '你是一位考研辅导老师，擅长用通俗易懂的语言讲解知识点。请根据用户提供的知识点，进行详细但简洁的讲解，帮助用户理解和记忆。注意：1) 先解释核心概念 2) 用简单例子说明 3) 给出记忆技巧或关联点。回答用中文，控制在 300 字以内。'
            },
            {
                role: 'user',
                content: `请帮我讲解这个知识点：\n\n学科：${item.subject}${item.subSubject ? '（' + item.subSubject + '）' : ''}\n分类：${item.topic || '未分类'}\n内容：${item.content || '（图片知识点，无文字内容）'}\n${item.note ? '备注：' + item.note : ''}`
            }
        ];
        return await this.chat(messages, { temperature: 0.7, maxTokens: 2048 });
    }

    // AI 判断两个知识点是否相似
    async checkSimilarity(textA, textB) {
        const messages = [
            {
                role: 'system',
                content: '你是一位考研知识点分析专家。请判断用户提供的两段内容是否在考查同一个知识点。请回答：1) 结论：是/否 2) 相似度百分比 3) 简短理由（50字以内）。用中文回答。'
            },
            {
                role: 'user',
                content: `请判断以下两段内容是否在考同一个知识点：\n\n【内容 A】${textA}\n\n【内容 B】${textB}`
            }
        ];
        return await this.chat(messages, { temperature: 0.3, maxTokens: 300 });
    }

    // 测试连接
    async testConnection() {
        const messages = [
            { role: 'user', content: '请回复"连接成功"四个字。' }
        ];
        const result = await this.chat(messages, { temperature: 0, maxTokens: 20 });
        return result;
    }
}

// ===== 主应用 =====
class App {
    constructor() {
        this.store = new KnowledgeStore();
        this.pendingItem = null;
        this.uploadedImages = [];
        this.subSubjects = this.loadSubSubjects();
        this.selectedSubSubject = null;  // 当前选中的专业课子科目
        this.voiceInput = new VoiceInput();
        this.aiClient = new AIClient();
        this.aiCurrentItem = null;  // AI 弹窗当前操作的知识点
        this.currentCalendarMonth = null;  // 当前日历显示的月份（Date 对象）
        this.init();
    }

    init() {
        try {
            console.log('[App.init] 开始初始化...');
            this.bindTabs();
            console.log('[App.init] bindTabs 完成');
            this.bindSubjectChange();
            console.log('[App.init] bindSubjectChange 完成');
            this.bindSubSubjects();
            console.log('[App.init] bindSubSubjects 完成');
            this.bindVoiceInput();
            console.log('[App.init] bindVoiceInput 完成');
            this.bindForm();
            console.log('[App.init] bindForm 完成');
            this.bindImageUpload();
            console.log('[App.init] bindImageUpload 完成');
            this.bindBrowse();
            console.log('[App.init] bindBrowse 完成');
            this.bindReview();
            console.log('[App.init] bindReview 完成');
            this.bindCheckin();
            console.log('[App.init] bindCheckin 完成');
            this.bindProfile();
            console.log('[App.init] bindProfile 完成');
            this.bindStats();
            console.log('[App.init] bindStats 完成');
            this.bindAISettings();
            console.log('[App.init] bindAISettings 完成');
            this.bindModals();
            console.log('[App.init] bindModals 完成');
            console.log('[App.init] ✅ 所有初始化完成');
        } catch (error) {
            console.error('[App.init] ❌ 初始化失败:', error);
            throw error;
        }
    }

    // ===== 标签页切换 =====
    bindTabs() {
        const tabs = document.querySelectorAll('.sidebar-btn');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
                const targetPanel = document.getElementById(`${tab.dataset.tab}-panel`);
                targetPanel.classList.add('active');

                if (tab.dataset.tab === 'browse') {
                    this.populateFilterDropdown();
                    this.renderKnowledgeList();
                }
                if (tab.dataset.tab === 'review') {
                    this.populateReviewDropdown();
                }
                if (tab.dataset.tab === 'stats' || tab.dataset.tab === 'settings') this.renderStats();
                if (tab.dataset.tab === 'home') this.renderHome();
                if (tab.dataset.tab === 'profile') this.renderProfile();
            });
        });
    }

    // 渲染主页
    renderHome() {
        const now = new Date();

        // 考研倒计时：读取用户选择的届数（届数 = 考试年份 + 1）
        let jie = parseInt(localStorage.getItem('examJie') || '0');
        if (!jie) {
            // 默认当前年份对应的届：2026年 → 27届
            jie = now.getFullYear() + 1;
        }
        const examYear = jie - 1; // 届数减1为实际考试年份
        const examDate = new Date(examYear, 11, 21); // 12月21日
        const diffDays = Math.max(0, Math.ceil((examDate - now) / (1000 * 60 * 60 * 24)));
        document.getElementById('home-countdown-days').textContent = diffDays;
        document.getElementById('home-countdown-date').textContent =
            `${jie}届 · ${examYear}年12月21日（预计）`;

        // 更新届数选择器高亮
        document.querySelectorAll('.year-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.year) === jie);
        });

        // 今日收录统计
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const todayEnd = todayStart + 86400000;
        const todayItems = this.store.getAll().filter(item =>
            item.timestamp >= todayStart && item.timestamp < todayEnd
        );
        document.getElementById('home-today-count').textContent = todayItems.length;

        // 激励语：每次打开随机
        const quotes = [
            '每一个不曾起舞的日子，都是对生命的辜负。',
            '星光不问赶路人，时光不负有心人。',
            '你现在的努力，藏着你十年后的样子。',
            '没有白走的路，每一步都算数。',
            '将来的你，一定会感谢现在拼命的自己。',
            '既然选择了远方，便只顾风雨兼程。',
            '人生没有彩排，每一天都是现场直播。',
            '不要假装努力，结果不会陪你演戏。',
            '越努力，越幸运。',
            '熬过最苦的日子，做最酷的自己。',
            '今天多学一点知识，明天就少一句求人的话。',
            '努力到无能为力，拼搏到感动自己。',
            '你的负担将变成礼物，你受的苦将照亮你的路。',
            '成功不是将来才有的，而是从决定去做的那一刻起。',
            '路虽远，行则将至；事虽难，做则必成。'
        ];
        const randomIndex = Math.floor(Math.random() * quotes.length);
        document.getElementById('home-quote-text').textContent = quotes[randomIndex];

        // 打卡：显示今日日期
        const dateStr = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日`;
        document.getElementById('home-checkin-date').textContent = dateStr;

        // 加载今日打卡内容
        const checkins = this.getCheckins();
        const todayKey = this.getTodayKey();
        const todayCheckin = checkins[todayKey] || '';
        document.getElementById('home-checkin-text').value = todayCheckin;

        // 初始化当前选中日期（默认为今天）
        this.currentSelectedDate = null;
        document.getElementById('home-checkin-status').textContent = todayCheckin ? '今日已打卡' : '';
        this.updateCheckinButtons(!!todayCheckin);

        // 渲染历史记录
        this.renderCheckinHistory(checkins);

        // 渲染打卡日历
        this.renderCalendar(checkins);
    }

    // 获取今日 key
    getTodayKey() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    // 获取所有打卡记录
    getCheckins() {
        try {
            return JSON.parse(localStorage.getItem('checkins') || '{}');
        } catch {
            return {};
        }
    }

    // 保存打卡记录
    saveCheckins(checkins) {
        localStorage.setItem('checkins', JSON.stringify(checkins));
    }

    // 保存打卡（支持今日和补卡）
    saveTodayCheckin() {
        const text = document.getElementById('home-checkin-text').value.trim();
        if (!text) {
            document.getElementById('home-checkin-status').textContent = '请输入学习内容';
            return;
        }

        // 确定保存到哪个日期
        const targetDate = this.currentSelectedDate || this.getTodayKey();
        
        // 检查是否是未来日期（不允许打卡）
        const [year, month, day] = targetDate.split('-').map(Number);
        const clickedDate = new Date(year, month - 1, day);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (clickedDate > today) {
            this.showToast('不可提前打卡', 'error');
            return;
        }
        
        const checkins = this.getCheckins();
        checkins[targetDate] = text;
        this.saveCheckins(checkins);
        
        // 显示状态提示
        const isToday = !this.currentSelectedDate;
        document.getElementById('home-checkin-status').textContent = isToday ? '已保存' : '已补卡';
        
        this.renderCheckinHistory(checkins);
        this.renderCalendar(checkins, this.currentSelectedDate);
        this.updateCheckinButtons(true);
        
        setTimeout(() => {
            document.getElementById('home-checkin-status').textContent = isToday ? '今日已打卡' : '已补卡';
        }, 1500);
    }

    // 修改打卡（支持今日和补卡）
    modifyTodayCheckin() {
        const text = document.getElementById('home-checkin-text').value.trim();
        if (!text) {
            document.getElementById('home-checkin-status').textContent = '请输入学习内容';
            return;
        }

        // 确定修改哪个日期
        const targetDate = this.currentSelectedDate || this.getTodayKey();
        
        const checkins = this.getCheckins();
        checkins[targetDate] = text;
        this.saveCheckins(checkins);
        
        const isToday = !this.currentSelectedDate;
        document.getElementById('home-checkin-status').textContent = isToday ? '已修改' : '已修改';
        
        this.renderCheckinHistory(checkins);
        this.renderCalendar(checkins, this.currentSelectedDate);
        
        setTimeout(() => {
            document.getElementById('home-checkin-status').textContent = isToday ? '今日已打卡' : '已补卡';
        }, 1500);
    }

    // 删除打卡（支持今日和补卡）
    deleteTodayCheckin() {
        if (!confirm('确定要删除这条打卡记录吗？')) return;

        // 确定删除哪个日期
        const targetDate = this.currentSelectedDate || this.getTodayKey();
        
        const checkins = this.getCheckins();
        delete checkins[targetDate];
        this.saveCheckins(checkins);
        
        document.getElementById('home-checkin-text').value = '';
        
        const isToday = !this.currentSelectedDate;
        document.getElementById('home-checkin-status').textContent = '已删除';
        
        this.renderCheckinHistory(checkins);
        this.renderCalendar(checkins, null); // 删除后清除选中状态
        this.updateCheckinButtons(false);
        
        setTimeout(() => {
            document.getElementById('home-checkin-status').textContent = '';
        }, 1500);
    }

    // 更新打卡按钮显示状态
    updateCheckinButtons(hasCheckin) {
        const modifyBtn = document.getElementById('btn-modify-checkin');
        const deleteBtn = document.getElementById('btn-delete-checkin');
        if (modifyBtn) modifyBtn.style.display = hasCheckin ? 'inline-flex' : 'none';
        if (deleteBtn) deleteBtn.style.display = hasCheckin ? 'inline-flex' : 'none';
    }

    // 切换月份
    switchMonth(delta) {
        // 初始化当前显示的月份
        if (!this.currentCalendarMonth) {
            this.currentCalendarMonth = new Date();
        }
        
        // 计算新月份
        const newMonth = new Date(this.currentCalendarMonth);
        newMonth.setMonth(newMonth.getMonth() + delta);
        
        // 更新当前显示的月份
        this.currentCalendarMonth = newMonth;
        
        // 重新渲染日历
        const checkins = this.getCheckins();
        this.renderCalendar(checkins, this.currentSelectedDate);
    }

    // 处理日历格子点击
    handleCalendarClick(cellElement) {
        const dateStr = cellElement.dataset.date;
        if (!dateStr) return;

        const [year, month, day] = dateStr.split('-').map(Number);
        const clickedDate = new Date(year, month - 1, day);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 检查是否是未来日期（不允许选中）
        if (clickedDate > today) {
            this.showToast('不可选择未来日期', 'error');
            return;
        }

        // 移除所有选中状态
        document.querySelectorAll('.calendar-cell.selected').forEach(el => el.classList.remove('selected'));
        
        // 添加选中状态
        cellElement.classList.add('selected');

        // 更新打卡卡片标题和内容
        const isToday = clickedDate.getTime() === today.getTime();
        const titleEl = document.querySelector('.home-checkin-header span:nth-child(2)');
        const textarea = document.getElementById('home-checkin-text');
        const statusEl = document.getElementById('home-checkin-status');
        const checkins = this.getCheckins();

        if (isToday) {
            titleEl.textContent = '今日打卡';
            textarea.value = checkins[this.getTodayKey()] || '';
        } else {
            const monthDay = `${month}月${day}日`;
            titleEl.textContent = `${monthDay} 打卡`;
            textarea.value = checkins[dateStr] || '';
        }

        // 更新当前选中的日期
        this.currentSelectedDate = isToday ? null : dateStr;

        // 更新按钮状态
        const hasContent = textarea.value.trim();
        this.updateCheckinButtons(hasContent);

        // 清空状态提示
        statusEl.textContent = '';
    }

    // 显示 Toast 提示
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    // 渲染打卡历史
    renderCheckinHistory(checkins) {
        const container = document.getElementById('home-checkin-history');
        const keys = Object.keys(checkins).sort().reverse().slice(0, 7); // 最近 7 条
        if (keys.length === 0) {
            container.innerHTML = '';
            return;
        }
        let html = '<div class="home-checkin-history-title">近期打卡</div>';
        keys.forEach(key => {
            const [y, m, d] = key.split('-');
            html += `
                <div class="home-checkin-history-item">
                    <div class="home-checkin-history-date">${y}年${m}月${d}日</div>
                    <div class="home-checkin-history-text">${this.escapeHtml(checkins[key])}</div>
                </div>
            `;
        });
        container.innerHTML = html;
    }

    // 渲染打卡日历（标准月历网格）
    renderCalendar(checkins, selectedDate = null) {
        const grid = document.getElementById('home-calendar');
        if (!grid) return;

        // 使用当前显示的月份，如果没有则使用当前日期
        const displayDate = this.currentCalendarMonth || new Date();
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const year = displayDate.getFullYear();
        const month = displayDate.getMonth(); // 0-based

        console.log('=== Calendar Debug Start ===');
        console.log(`Current: ${year}年${month + 1}月`);

        // 当月第一天和最后一天
        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);
        const daysInMonth = lastDayOfMonth.getDate();
        const firstDayWeekday = firstDayOfMonth.getDay(); // 0=周日, 1=周一, ..., 6=周六

        console.log(`1st day weekday: ${firstDayWeekday} (0=Sun, 1=Mon, ..., 6=Sat)`);
        console.log(`Days in month: ${daysInMonth}`);

        // 计算需要多少行（周）
        const totalDays = firstDayWeekday + daysInMonth;
        const weeks = Math.ceil(totalDays / 7);
        console.log(`Total weeks needed: ${weeks}`);

        // 生成所有日期数据（按行组织，每行7天）
        const cells = [];
        
        // 上月末尾日期
        const prevMonthLastDay = new Date(year, month, 0).getDate();
        for (let i = 0; i < firstDayWeekday; i++) {
            const day = prevMonthLastDay - firstDayWeekday + i + 1;
            const d = new Date(year, month - 1, day);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const checkin = checkins[key];
            const isChecked = checkin && checkin.trim();
            const isFuture = d > today;
            
            cells.push({
                date: d,
                key,
                isChecked: !isFuture && isChecked,
                isToday: false,
                isCurrentMonth: false,
                isEmpty: isFuture,
                isRetroactive: true // 上月日期都是补卡
            });
        }

        // 当月日期
        for (let day = 1; day <= daysInMonth; day++) {
            const d = new Date(year, month, day);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const checkin = checkins[key];
            const isChecked = checkin && checkin.trim();
            const isToday = d.getTime() === today.getTime();
            const isFuture = d > today;
            
            cells.push({
                date: d,
                key,
                isChecked: !isFuture && isChecked,
                isToday,
                isCurrentMonth: true,
                isEmpty: isFuture,
                isRetroactive: !isToday && !isFuture && isChecked // 非今日且已打卡的是补卡
            });
        }

        // 下月开头日期（填满最后一行）
        const remainingCells = weeks * 7 - cells.length;
        for (let day = 1; day <= remainingCells; day++) {
            const d = new Date(year, month + 1, day);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const checkin = checkins[key];
            const isChecked = checkin && checkin.trim();
            const isFuture = d > today;
            
            cells.push({
                date: d,
                key,
                isChecked: !isFuture && isChecked,
                isToday: false,
                isCurrentMonth: false,
                isEmpty: isFuture,
                isRetroactive: true // 下月日期都是补卡
            });
        }

        console.log(`Generated ${cells.length} cells (${weeks} rows × 7 cols)`);
        console.log(`First cell: ${cells[0].date.toLocaleDateString()}`);
        console.log(`Last cell: ${cells[cells.length - 1].date.toLocaleDateString()}`);

        // 渲染月份标题和星期标签
        const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        
        let calendarHtml = `
            <div class="calendar-month-title">${year}年${monthNames[month]}</div>
            <div class="calendar-weekday-labels">
                ${weekdays.map(day => `<span>${day}</span>`).join('')}
            </div>
            <div class="calendar-grid">
        `;

        // 渲染所有日期格子（CSS Grid 自动排列）
        const currentDate = new Date();
        currentDate.setHours(0, 0, 0, 0);
        
        cells.forEach(cell => {
            let classes = 'calendar-cell';
            if (cell.isEmpty) {
                classes += ' empty';
            } else if (cell.isChecked) {
                classes += ' checked';
                // 区分今日打卡和补卡
                if (cell.isRetroactive) {
                    classes += ' retroactive';
                }
            }
            if (cell.isToday) classes += ' today';
            if (!cell.isCurrentMonth) classes += ' other-month';
            
            // 标记未来日期（禁用状态）
            if (cell.date > currentDate) classes += ' future-date';
            
            const dateStr = `${cell.date.getFullYear()}-${String(cell.date.getMonth() + 1).padStart(2, '0')}-${String(cell.date.getDate()).padStart(2, '0')}`;
            
            // 调试：输出9月30日的信息
            if (cell.date.getDate() === 30 && cell.date.getMonth() === 8) {
                console.log(`[Calendar Debug] Sep 30: isCurrentMonth=${cell.isCurrentMonth}, isEmpty=${cell.isEmpty}, isChecked=${cell.isChecked}, isFuture=${cell.date > new Date()}`);
            }
            
            // 显示日期数字
            calendarHtml += `<div class="${classes}" data-date="${dateStr}">${cell.date.getDate()}</div>`;
        });
        
        calendarHtml += '</div>'; // 关闭 calendar-grid
        grid.innerHTML = calendarHtml;
        
        // 绑定点击事件
        const cellElements = grid.querySelectorAll('.calendar-cell');
        cellElements.forEach(cell => {
            cell.addEventListener('click', () => this.handleCalendarClick(cell));
        });
        
        console.log(`Rendered ${cells.length} cells in ${weeks} rows`);
        console.log('=== Calendar Debug End ===');
    }

    // HTML 转义
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ===== 我的面板 =====
    renderProfile() {
        // 加载已保存的信息
        const profile = this.getProfile();
        const nicknameInput = document.getElementById('profile-nickname');
        const universityInput = document.getElementById('profile-university');
        if (profile.nickname && nicknameInput) nicknameInput.value = profile.nickname;
        if (profile.university && universityInput) universityInput.value = profile.university;

        // 加载头像
        if (profile.avatar) {
            const img = document.getElementById('profile-avatar-img');
            const defaultAvatar = document.getElementById('profile-avatar-default');
            if (img) {
                img.src = profile.avatar;
                img.style.display = 'block';
            }
            if (defaultAvatar) defaultAvatar.style.display = 'none';
        } else {
            const img = document.getElementById('profile-avatar-img');
            const defaultAvatar = document.getElementById('profile-avatar-default');
            if (img) img.style.display = 'none';
            if (defaultAvatar) defaultAvatar.style.display = 'flex';
        }

        // 学习概览统计
        const checkins = this.getCheckins();
        const totalDays = Object.keys(checkins).filter(k => checkins[k].trim()).length;
        const totalDaysEl = document.getElementById('profile-total-days');
        const totalKnowledgeEl = document.getElementById('profile-total-knowledge');
        const streakDaysEl = document.getElementById('profile-streak-days');
        
        if (totalDaysEl) totalDaysEl.textContent = totalDays;
        if (totalKnowledgeEl) totalKnowledgeEl.textContent = this.store.getAll().length;

        // 连续打卡天数
        let streak = 0;
        const today = new Date();
        for (let i = 0; i < 365; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (checkins[key] && checkins[key].trim()) {
                streak++;
            } else if (i > 0) {
                break;
            }
        }
        if (streakDaysEl) streakDaysEl.textContent = streak;
    }

    getProfile() {
        try {
            return JSON.parse(localStorage.getItem('userProfile') || '{}');
        } catch {
            return {};
        }
    }

    saveProfile() {
        const profile = this.getProfile();
        const nicknameInput = document.getElementById('profile-nickname');
        const universityInput = document.getElementById('profile-university');
        const saveStatus = document.getElementById('profile-save-status');
        
        if (nicknameInput) profile.nickname = nicknameInput.value.trim();
        if (universityInput) profile.university = universityInput.value.trim();
        
        localStorage.setItem('userProfile', JSON.stringify(profile));
        
        if (saveStatus) {
            saveStatus.textContent = '✓ 已保存';
            setTimeout(() => {
                saveStatus.textContent = '';
            }, 2000);
        }
    }

    bindProfile() {
        // 保存按钮
        const saveBtn = document.getElementById('btn-save-profile');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveProfile());
        }

        // 头像上传
        const avatarInput = document.getElementById('avatar-input');
        const editAvatarBtn = document.getElementById('btn-edit-avatar');
        if (editAvatarBtn && avatarInput) {
            editAvatarBtn.addEventListener('click', () => avatarInput.click());
            avatarInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                // 压缩头像
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const size = 160;
                    canvas.width = size;
                    canvas.height = size;
                    const ctx = canvas.getContext('2d');
                    const scale = Math.max(size / img.width, size / img.height);
                    const w = img.width * scale;
                    const h = img.height * scale;
                    const x = (size - w) / 2;
                    const y = (size - h) / 2;
                    ctx.drawImage(img, x, y, w, h);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

                    const profile = this.getProfile();
                    profile.avatar = dataUrl;
                    localStorage.setItem('userProfile', JSON.stringify(profile));

                    const avatarImg = document.getElementById('profile-avatar-img');
                    avatarImg.src = dataUrl;
                    avatarImg.style.display = 'block';
                    document.getElementById('profile-avatar-default').style.display = 'none';
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
            avatarInput.value = '';
        });
        }
    }

    // ===== 学科切换联动 =====
    bindSubjectChange() {
        const subjectSelect = document.getElementById('subject');
        subjectSelect.addEventListener('change', () => {
            const area = document.getElementById('sub-subject-area');
            if (subjectSelect.value === '专业课') {
                area.style.display = '';
                this.renderSubSubjectTags();
            } else {
                area.style.display = 'none';
            }
        });
    }

    // ===== 专业课子科目管理 =====
    loadSubSubjects() {
        try {
            const raw = localStorage.getItem(SUB_SUBJECT_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    saveSubSubjects() {
        localStorage.setItem(SUB_SUBJECT_KEY, JSON.stringify(this.subSubjects));
    }

    bindSubSubjects() {
        const addBtn = document.getElementById('btn-add-sub-subject');
        const input = document.getElementById('sub-subject-input');

        // 点击添加按钮
        addBtn.addEventListener('click', () => {
            this.addSubSubject(input.value.trim());
            input.value = '';
            input.focus();
        });

        // 回车添加
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addSubSubject(input.value.trim());
                input.value = '';
            }
        });
    }

    addSubSubject(name) {
        if (!name) {
            showToast('请输入子科目名称', 'warning');
            return;
        }
        if (this.subSubjects.includes(name)) {
            showToast('该子科目已存在', 'warning');
            return;
        }
        this.subSubjects.push(name);
        this.saveSubSubjects();
        this.renderSubSubjectTags();
        this.populateFilterDropdown();
        showToast(`已添加子科目「${name}」`, 'success');
    }

    removeSubSubject(name) {
        this.subSubjects = this.subSubjects.filter(s => s !== name);
        this.saveSubSubjects();
        this.renderSubSubjectTags();
        this.populateFilterDropdown();
    }

    renderSubSubjectTags() {
        const container = document.getElementById('sub-subject-tags');
        const topicInput = document.getElementById('topic');
        const currentValue = topicInput.value.trim();

        container.innerHTML = this.subSubjects.map(name => {
            const isActive = name === currentValue ? 'active' : '';
            return `<span class="sub-subject-tag ${isActive}" data-name="${this.escapeHtml(name)}">
                ${this.escapeHtml(name)}
                <button type="button" class="tag-delete" data-name="${this.escapeHtml(name)}" title="删除此子科目">&times;</button>
            </span>`;
        }).join('');

        // 点击标签 -> 填入知识点分类，并记录选中的子科目
        container.querySelectorAll('.sub-subject-tag').forEach(tag => {
            tag.addEventListener('click', (e) => {
                if (e.target.classList.contains('tag-delete')) return;
                const name = tag.dataset.name;
                topicInput.value = name;
                this.selectedSubSubject = name;  // 记录选中的子科目
                // 更新选中状态
                container.querySelectorAll('.sub-subject-tag').forEach(t => t.classList.remove('active'));
                tag.classList.add('active');
            });
        });

        // 点击删除按钮 -> 移除子科目
        container.querySelectorAll('.tag-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const name = btn.dataset.name;
                if (confirm(`确定删除子科目「${name}」吗？`)) {
                    this.removeSubSubject(name);
                }
            });
        });
    }

    // ===== 语音输入 =====
    bindVoiceInput() {
        const voiceBtn = document.getElementById('voice-btn');
        const voiceStatus = document.getElementById('voice-status');
        const voiceStatusText = document.getElementById('voice-status-text');
        const voiceStopBtn = document.getElementById('voice-stop-btn');
        const voiceText = voiceBtn.querySelector('.voice-text');
        const textarea = document.getElementById('content-text');

        // 检查浏览器支持
        if (!this.voiceInput.isSupported) {
            voiceBtn.classList.add('unsupported');
            voiceBtn.title = '当前浏览器不支持语音输入，请使用 Chrome 或 Edge';
            voiceText.textContent = '不支持';
            return;
        }

        let voiceOriginalContent = '';  // 录音前文本框原有内容

        // 点击麦克风按钮
        voiceBtn.addEventListener('click', () => {
            this.voiceInput.toggle();
        });

        // 点击停止按钮
        voiceStopBtn.addEventListener('click', () => {
            this.voiceInput.stopRecording();
        });

        // 开始录音回调
        this.voiceInput.onStart = () => {
            voiceOriginalContent = textarea.value;
            voiceBtn.classList.add('recording');
            voiceText.textContent = '录音中...';
            voiceStatus.style.display = 'flex';
            voiceStatusText.textContent = '正在聆听，请说话...';
        };

        // 停止录音回调
        this.voiceInput.onStop = () => {
            voiceBtn.classList.remove('recording');
            voiceText.textContent = '语音输入';
            voiceStatus.style.display = 'none';
        };

        // 识别结果回调
        this.voiceInput.onResult = (finalText, interimText) => {
            // 将识别到的文字追加到文本框
            if (finalText) {
                const currentVal = textarea.value;
                // 如果当前内容是原始内容 + 之前的临时结果，替换掉临时部分
                if (currentVal.startsWith(voiceOriginalContent)) {
                    textarea.value = voiceOriginalContent + (voiceOriginalContent && !voiceOriginalContent.endsWith('\n') && finalText ? '\n' : '') + finalText;
                } else {
                    textarea.value = currentVal + finalText;
                }
                voiceOriginalContent = textarea.value;
            }

            // 显示中间结果（灰色提示）
            if (interimText) {
                voiceStatusText.textContent = `识别中：${interimText}`;
            } else if (finalText) {
                voiceStatusText.textContent = '✓ 已识别，请继续说话...';
            }
        };

        // 错误回调
        this.voiceInput.onError = (msg) => {
            showToast(msg, 'error');
            this.voiceInput.stopRecording();
        };
    }

    // ===== 表单提交 =====
    bindForm() {
        const form = document.getElementById('knowledge-form');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleFormSubmit();
        });
    }

    handleFormSubmit() {
        const subject = document.getElementById('subject').value;
        const topic = document.getElementById('topic').value.trim();
        const content = document.getElementById('content-text').value.trim();
        const note = document.getElementById('note').value.trim();

        // 验证
        if (!subject) {
            showToast('请选择学科分类', 'warning');
            return;
        }
        if (!content && this.uploadedImages.length === 0) {
            showToast('请输入知识点内容或上传图片', 'warning');
            return;
        }

        // 构建知识点对象
        const item = {
            id: generateId(),
            subject: subject,
            topic: topic || '未分类',
            subSubject: this.selectedSubSubject || null,  // 保存选中的专业课子科目
            content: content,
            images: [...this.uploadedImages],
            note: note,
            timestamp: Date.now(),
            duplicateCount: 1
        };

        // 查重检测（仅对文字内容进行相似度检查）
        if (content) {
            const duplicates = SimilarityEngine.findDuplicates(content, this.store);
            if (duplicates.length > 0) {
                // 计算总收录次数
                const totalOccurrences = SimilarityEngine.countOccurrences(content, this.store) + 1;
                item.duplicateCount = totalOccurrences;
                this.showDuplicateModal(duplicates, item);
                return;
            }
        }

        // 无重复，直接保存
        this.saveKnowledgePoint(item);
    }

    saveKnowledgePoint(item) {
        this.store.add(item);
        this.resetForm();
        showToast('知识点收录成功！', 'success');
    }

    resetForm() {
        document.getElementById('knowledge-form').reset();
        this.uploadedImages = [];
        this.renderImagePreviews();
        document.getElementById('upload-placeholder').style.display = '';
        // 隐藏子科目区域并清除选中状态
        document.getElementById('sub-subject-area').style.display = 'none';
        document.querySelectorAll('.sub-subject-tag').forEach(t => t.classList.remove('active'));
        this.selectedSubSubject = null;
    }

    // ===== 图片上传 =====
    bindImageUpload() {
        const uploadArea = document.getElementById('image-upload-area');
        const fileInput = document.getElementById('image-input');

        uploadArea.addEventListener('click', () => fileInput.click());

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            this.handleImageFiles(e.dataTransfer.files);
        });

        fileInput.addEventListener('change', (e) => {
            this.handleImageFiles(e.target.files);
            fileInput.value = '';
        });
    }

    handleImageFiles(files) {
        Array.from(files).forEach(file => {
            if (!file.type.startsWith('image/')) return;
            if (file.size > 5 * 1024 * 1024) {
                showToast('图片大小不能超过 5MB', 'warning');
                return;
            }

            const reader = new FileReader();
            reader.onload = async (e) => {
                const originalDataUrl = e.target.result;
                // 压缩图片后再存储
                const compressed = await compressImage(originalDataUrl);
                this.uploadedImages.push(compressed);
                this.renderImagePreviews();
            };
            reader.readAsDataURL(file);
        });
    }

    renderImagePreviews() {
        const list = document.getElementById('image-preview-list');
        const placeholder = document.getElementById('upload-placeholder');

        if (this.uploadedImages.length > 0) {
            placeholder.style.display = 'none';
        } else {
            placeholder.style.display = '';
        }

        list.innerHTML = this.uploadedImages.map((img, index) => `
            <div class="image-preview-item">
                <img src="${img}" alt="预览" />
                <button class="remove-img" data-index="${index}">&times;</button>
            </div>
        `).join('');

        // 绑定删除按钮
        list.querySelectorAll('.remove-img').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                this.uploadedImages.splice(index, 1);
                this.renderImagePreviews();
            });
        });
    }

    // ===== 重复提醒弹窗 =====
    showDuplicateModal(duplicates, item) {
        this.pendingItem = item;
        const modal = document.getElementById('duplicate-modal');
        const listEl = document.getElementById('duplicate-list');

        listEl.innerHTML = duplicates.slice(0, 5).map(dup => {
            const simPercent = Math.round(dup.similarity * 100);
            const simClass = simPercent >= 80 ? 'similarity-high' : 'similarity-medium';
            const dupCount = dup.item.duplicateCount || 1;
            return `
                <div class="duplicate-item" data-dup-id="${dup.item.id}">
                    <div class="duplicate-item-header">
                        <span class="knowledge-subject-tag ${getSubjectClass(dup.item.subject)}">${dup.item.subject}${this.getDisplaySubSubject(dup.item) ? ' · ' + this.escapeHtml(this.getDisplaySubSubject(dup.item)) : ''}</span>
                        <span class="duplicate-item-similarity ${simClass}">相似度 ${simPercent}%</span>
                    </div>
                    <div class="duplicate-item-content">${this.escapeHtml(dup.item.content)}</div>
                    <div class="duplicate-item-time">${formatTime(dup.item.timestamp)} · ${dup.item.topic} · 已收录 ${dupCount} 次</div>
                    <div class="duplicate-item-actions">
                        <button type="button" class="btn-merge" data-target-id="${dup.item.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>合并到该条目</button>
                    </div>
                </div>
            `;
        }).join('');

        // 绑定合并按钮事件
        listEl.querySelectorAll('.btn-merge').forEach(btn => {
            btn.addEventListener('click', () => {
                this.mergeToExisting(btn.dataset.targetId);
            });
        });

        modal.classList.add('active');
    }

    // 合并到已有条目（增加其收录次数，不创建新条目）
    mergeToExisting(targetId) {
        const target = this.store.getById(targetId);
        if (!target) {
            showToast('目标条目不存在', 'error');
            return;
        }

        // 增加目标条目的收录次数
        target.duplicateCount = (target.duplicateCount || 1) + 1;
        // 更新存储（找到并替换）
        const idx = this.store.data.findIndex(item => item.id === targetId);
        if (idx !== -1) {
            this.store.data[idx] = target;
            this.store.save();
        }

        // 关闭弹窗，重置表单
        document.getElementById('duplicate-modal').classList.remove('active');
        this.pendingItem = null;
        this.resetForm();
        showToast(`已合并到「${target.topic}」条目，该知识点共收录 ${target.duplicateCount} 次`, 'success');
    }

    // ===== 总览面板 =====
    bindBrowse() {
        const searchInput = document.getElementById('search-input');
        const filterSubject = document.getElementById('filter-subject');
        const filterSort = document.getElementById('filter-sort');

        this.populateFilterDropdown();

        let debounceTimer;
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => this.renderKnowledgeList(), 300);
        });

        filterSubject.addEventListener('change', () => this.renderKnowledgeList());
        filterSort.addEventListener('change', () => this.renderKnowledgeList());
    }

    // 动态生成筛选下拉框选项
    populateFilterDropdown() {
        const select = document.getElementById('filter-subject');
        const currentValue = select.value;

        let html = '<option value="">全部学科</option>';
        html += '<option value="政治">政治</option>';
        html += '<option value="英语">英语</option>';
        html += '<option value="数学">数学</option>';

        // 专业课及子科目用 optgroup 分组
        if (this.subSubjects.length > 0) {
            html += '<optgroup label="专业课">';
            html += '<option value="专业课">  全部专业课</option>';
            this.subSubjects.forEach(sub => {
                html += `<option value="专业课::${sub}">  ${sub}</option>`;
            });
            html += '</optgroup>';
        } else {
            html += '<option value="专业课">专业课</option>';
        }

        select.innerHTML = html;
        select.value = currentValue;  // 恢复之前选中的值
    }

    renderKnowledgeList() {
        const listEl = document.getElementById('knowledge-list');
        const searchQuery = document.getElementById('search-input').value.trim().toLowerCase();
        const filterSubject = document.getElementById('filter-subject').value;
        const filterSort = document.getElementById('filter-sort').value;

        let items = [...this.store.getAll()];

        // 筛选
        if (filterSubject) {
            if (filterSubject.includes('::')) {
                // 子科目筛选：如 "专业课::OS"
                const [subject, subSubject] = filterSubject.split('::');
                items = items.filter(item => {
                    if (item.subject !== subject) return false;
                    const displaySub = this.getDisplaySubSubject(item);
                    return displaySub && displaySub.toLowerCase() === subSubject.toLowerCase();
                });
            } else {
                items = items.filter(item => item.subject === filterSubject);
            }
        }
        if (searchQuery) {
            items = items.filter(item => {
                const searchText = `${item.content} ${item.topic} ${item.note} ${item.subject}`.toLowerCase();
                return searchText.includes(searchQuery);
            });
        }

        // 排序
        switch (filterSort) {
            case 'time-asc':
                items.sort((a, b) => a.timestamp - b.timestamp);
                break;
            case 'count-desc':
                items.sort((a, b) => (b.duplicateCount || 1) - (a.duplicateCount || 1));
                break;
            default:
                items.sort((a, b) => b.timestamp - a.timestamp);
        }

        if (items.length === 0) {
            listEl.innerHTML = `
                <div class="empty-state">
                    <svg class="empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8V21H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
                    <p>${searchQuery || filterSubject ? '未找到匹配的知识点' : '暂无知识点记录'}</p>
                </div>
            `;
            return;
        }

        listEl.innerHTML = items.map(item => {
            const dupCount = item.duplicateCount || 1;
            const dupBadge = dupCount > 1
                ? `<span class="knowledge-duplicate-badge ${dupCount >= 3 ? 'high' : ''}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px;"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>已收录 ${dupCount} 次</span>`
                : '';

            const imagesHtml = (item.images && item.images.length > 0)
                ? `<div class="knowledge-images">${item.images.slice(0, 3).map(img => `<img src="${img}" alt="附图">`).join('')}${item.images.length > 3 ? `<span style="color:var(--text-lighter);font-size:0.8rem;line-height:50px;">+${item.images.length - 3}</span>` : ''}</div>`
                : '';

            return `
                <div class="knowledge-item" data-id="${item.id}">
                    <div class="knowledge-item-header">
                        <span class="knowledge-subject-tag ${getSubjectClass(item.subject)}">${item.subject}${this.getDisplaySubSubject(item) ? ' · ' + this.escapeHtml(this.getDisplaySubSubject(item)) : ''}</span>
                        ${dupBadge}
                    </div>
                    <div class="knowledge-content-preview">${this.escapeHtml(item.content) || '（图片知识点）'}</div>
                    ${imagesHtml}
                    <div class="knowledge-meta">
                        <span class="knowledge-topic">${this.escapeHtml(item.topic)}</span>
                        <span style="display:flex;align-items:center;gap:6px;">
                            <button class="knowledge-ai-btn" data-ai-id="${item.id}" title="AI 讲解"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px;"><path d="M12 2a4 4 0 0 1 4 4v1a1 1 0 0 0 1 1h1a4 4 0 0 1 0 8h-1a1 1 0 0 0-1 1v1a4 4 0 0 1-8 0v-1a1 1 0 0 0-1-1H6a4 4 0 0 1 0-8h1a1 1 0 0 0 1-1V6a4 4 0 0 1 4-4z"/><circle cx="12" cy="12" r="2"/></svg>讲解</button>
                            <span>${formatTime(item.timestamp)}</span>
                        </span>
                    </div>
                </div>
            `;
        }).join('');

        // 绑定点击事件
        listEl.querySelectorAll('.knowledge-item').forEach(el => {
            el.addEventListener('click', (e) => {
                // 点击 AI 讲解按钮不触发详情弹窗
                if (e.target.closest('.knowledge-ai-btn')) {
                    e.stopPropagation();
                    const itemId = e.target.closest('.knowledge-ai-btn').dataset.aiId;
                    const item = this.store.getById(itemId);
                    if (item) this.showAIExplain(item);
                    return;
                }
                this.showDetail(el.dataset.id);
            });
        });
    }

    // ===== 详情弹窗 =====
    showDetail(id) {
        const item = this.store.getById(id);
        if (!item) return;

        const modal = document.getElementById('detail-modal');
        const contentEl = document.getElementById('detail-content');
        const dupCount = item.duplicateCount || 1;

        let imagesHtml = '';
        if (item.images && item.images.length > 0) {
            imagesHtml = `
                <div class="detail-field">
                    <div class="detail-field-label">图片附件</div>
                    <div class="detail-images">
                        ${item.images.map(img => `<img src="${img}" alt="附图" onclick="window.open('${img}')">`).join('')}
                    </div>
                </div>
            `;
        }

        contentEl.innerHTML = `
            <div class="detail-field">
                <div class="detail-field-label">学科</div>
                <div class="detail-field-value"><span class="knowledge-subject-tag ${getSubjectClass(item.subject)}">${item.subject}${this.getDisplaySubSubject(item) ? ' · ' + this.escapeHtml(this.getDisplaySubSubject(item)) : ''}</span></div>
            </div>
            <div class="detail-field">
                <div class="detail-field-label">知识点分类</div>
                <div class="detail-field-value">${this.escapeHtml(item.topic)}</div>
            </div>
            <div class="detail-field">
                <div class="detail-field-label">内容</div>
                <div class="detail-field-value">${this.escapeHtml(item.content) || '（无文字内容）'}</div>
            </div>
            ${imagesHtml}
            ${item.note ? `
            <div class="detail-field">
                <div class="detail-field-label">备注</div>
                <div class="detail-field-value">${this.escapeHtml(item.note)}</div>
            </div>
            ` : ''}
            <div class="detail-field">
                <div class="detail-field-label">收录时间</div>
                <div class="detail-field-value">${new Date(item.timestamp).toLocaleString('zh-CN')}</div>
            </div>
            <div class="detail-field">
                <div class="detail-field-label">收录次数</div>
                <div class="detail-field-value" style="font-weight:600;font-size:1.1rem;">${dupCount} 次</div>
            </div>
            <div class="detail-actions">
                <button class="btn btn-danger btn-sm" id="btn-delete-detail" data-id="${item.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>删除</button>
            </div>
        `;

        modal.classList.add('active');
    }

    deleteItem(id) {
        if (confirm('确定要删除这个知识点吗？')) {
            this.store.remove(id);
            document.getElementById('detail-modal').classList.remove('active');
            this.renderKnowledgeList();
            showToast('已删除', 'info');
        }
    }

    // ===== 统计面板 =====
    bindStats() {
        const exportBtn = document.getElementById('btn-export');
        const importBtn = document.getElementById('btn-import');
        const importInput = document.getElementById('import-file-input');
        const clearBtn = document.getElementById('btn-clear');

        if (exportBtn) exportBtn.addEventListener('click', () => this.exportData());
        if (importBtn) importBtn.addEventListener('click', () => {
            if (importInput) importInput.click();
        });
        if (importInput) importInput.addEventListener('change', (e) => this.importData(e));
        if (clearBtn) clearBtn.addEventListener('click', () => this.clearData());
    }

    renderStats() {
        const items = this.store.getAll();
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const weekStart = todayStart - (now.getDay() || 7) * 86400000 + 86400000;

        // 基础统计
        document.getElementById('stat-total').textContent = items.length;
        document.getElementById('stat-today').textContent = items.filter(i => i.timestamp >= todayStart).length;
        document.getElementById('stat-week').textContent = items.filter(i => i.timestamp >= weekStart).length;

        // 重复收录数
        const duplicates = items.filter(i => (i.duplicateCount || 1) > 1);
        document.getElementById('stat-duplicates').textContent = duplicates.length;

        // 存储用量
        const usage = getStorageUsage();
        const usagePercent = Math.round((usage.usedKB / usage.totalKB) * 100);
        const storageText = document.getElementById('storage-usage');
        const storageBarFill = document.getElementById('storage-bar-fill');
        storageText.textContent = `${usage.usedMB}MB / ${usage.totalMB}MB (${usagePercent}%)`;
        storageBarFill.style.width = `${Math.min(usagePercent, 100)}%`;
        storageBarFill.className = 'storage-bar-fill';
        if (usagePercent > 80) storageBarFill.classList.add('danger');
        else if (usagePercent > 50) storageBarFill.classList.add('warning');

        // 学科分布
        const subjectCounts = {};
        items.forEach(item => {
            subjectCounts[item.subject] = (subjectCounts[item.subject] || 0) + 1;
        });

        const maxCount = Math.max(...Object.values(subjectCounts), 1);
        const distEl = document.getElementById('subject-distribution');

        if (Object.keys(subjectCounts).length === 0) {
            distEl.innerHTML = '<p class="empty-text">暂无数据</p>';
        } else {
            distEl.innerHTML = Object.entries(subjectCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([subject, count]) => `
                    <div class="distribution-item">
                        <span class="distribution-label">${subject}</span>
                        <div class="distribution-bar">
                            <div class="distribution-bar-fill" style="width: ${(count / maxCount) * 100}%"></div>
                        </div>
                        <span class="distribution-count">${count}</span>
                    </div>
                `).join('');
        }

        // 高频重复 TOP 5
        const topEl = document.getElementById('top-duplicates');
        if (duplicates.length === 0) {
            topEl.innerHTML = '<p class="empty-text">暂无重复记录</p>';
        } else {
            const topItems = duplicates
                .sort((a, b) => (b.duplicateCount || 1) - (a.duplicateCount || 1))
                .slice(0, 5);

            topEl.innerHTML = topItems.map(item => `
                <div class="distribution-item" style="cursor:pointer" onclick="app.showDetail('${item.id}')">
                    <span class="distribution-label" style="min-width:auto;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${this.escapeHtml(item.content)}">${this.escapeHtml(item.content?.substring(0, 20) || '图片知识点')}${(item.content?.length || 0) > 20 ? '...' : ''}</span>
                    <div class="distribution-bar">
                        <div class="distribution-bar-fill" style="width: ${((item.duplicateCount || 1) / (topItems[0].duplicateCount || 1)) * 100}%"></div>
                    </div>
                    <span class="distribution-count">${item.duplicateCount || 1}次</span>
                </div>
            `).join('');
        }
    }

    // ===== 数据导入导出 =====
    exportData() {
        const data = this.store.getAll();
        if (data.length === 0) {
            showToast('暂无数据可导出', 'warning');
            return;
        }

        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `考研知识点_${new Date().toLocaleDateString('zh-CN')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('导出成功', 'success');
    }

    importData(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const items = JSON.parse(ev.target.result);
                if (!Array.isArray(items)) throw new Error('格式错误');
                this.store.importData(items);
                this.renderStats();
                showToast(`成功导入 ${items.length} 条知识点`, 'success');
            } catch (err) {
                showToast('导入失败：文件格式不正确', 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    clearData() {
        if (confirm('确定要清空所有数据吗？此操作不可恢复！')) {
            if (confirm('再次确认：所有知识点数据将被永久删除！')) {
                this.store.clear();
                this.renderStats();
                showToast('数据已清空', 'info');
            }
        }
    }

    // ===== 温习 =====
    reviewItems = [];
    reviewIndex = 0;

    populateReviewDropdown() {
        const select = document.getElementById('review-subject');
        const currentValue = select.value;
        let html = '<option value="">全部学科</option>';
        html += '<option value="政治">政治</option>';
        html += '<option value="英语">英语</option>';
        html += '<option value="数学">数学</option>';
        if (this.subSubjects.length > 0) {
            html += '<optgroup label="专业课">';
            html += '<option value="专业课">  全部专业课</option>';
            this.subSubjects.forEach(sub => {
                html += `<option value="专业课::${sub}">  ${sub}</option>`;
            });
            html += '</optgroup>';
        } else {
            html += '<option value="专业课">专业课</option>';
        }
        select.innerHTML = html;
        select.value = currentValue;
    }

    bindReview() {
        document.getElementById('btn-start-review').addEventListener('click', () => this.startReview());
        document.getElementById('btn-review-prev').addEventListener('click', () => this.reviewNav(-1));
        document.getElementById('btn-review-next').addEventListener('click', () => this.reviewNav(1));
        document.getElementById('btn-review-shuffle').addEventListener('click', () => this.shuffleReview());

        // 日期选择器：点击图标或文本框触发隐藏的 datetime-local
        const dateFields = [
            { hidden: 'review-date-from', display: 'review-date-from-display' },
            { hidden: 'review-date-to', display: 'review-date-to-display' }
        ];
        dateFields.forEach(({ hidden, display }) => {
            const hiddenInput = document.getElementById(hidden);
            const displayInput = document.getElementById(display);
            const btn = displayInput.parentElement.querySelector('.date-picker-btn');

            // 打开日期选择器的函数（兼容 Safari/iPadOS）
            const openPicker = () => {
                // 先尝试 showPicker()（Chrome/Edge）
                if (typeof hiddenInput.showPicker === 'function') {
                    try {
                        hiddenInput.showPicker();
                        return;
                    } catch (e) {
                        // showPicker 失败，使用 fallback
                    }
                }
                // Fallback：临时移除 hidden 属性，触发 click，再恢复
                hiddenInput.hidden = false;
                hiddenInput.style.position = 'absolute';
                hiddenInput.style.opacity = '0';
                hiddenInput.style.pointerEvents = 'none';
                hiddenInput.focus();
                hiddenInput.click();
                // 选择完成后恢复 hidden
                setTimeout(() => {
                    hiddenInput.hidden = true;
                    hiddenInput.style.position = '';
                    hiddenInput.style.opacity = '';
                    hiddenInput.style.pointerEvents = '';
                }, 100);
            };

            // 点击图标按钮打开日期选择器
            btn.addEventListener('click', openPicker);

            // 点击文本框也打开日期选择器
            displayInput.addEventListener('click', openPicker);

            // 选择日期后格式化显示
            hiddenInput.addEventListener('change', () => {
                if (hiddenInput.value) {
                    const date = new Date(hiddenInput.value);
                    const formatted = this.formatDateTime(date);
                    displayInput.value = formatted;
                } else {
                    displayInput.value = '';
                }
            });
        });
    }

    // 打卡功能绑定
    bindCheckin() {
        const saveBtn = document.getElementById('btn-save-checkin');
        const modifyBtn = document.getElementById('btn-modify-checkin');
        const deleteBtn = document.getElementById('btn-delete-checkin');

        if (saveBtn) saveBtn.addEventListener('click', () => this.saveTodayCheckin());
        if (modifyBtn) modifyBtn.addEventListener('click', () => this.modifyTodayCheckin());
        if (deleteBtn) deleteBtn.addEventListener('click', () => this.deleteTodayCheckin());

        // 月份切换按钮
        const prevMonthBtn = document.getElementById('btn-prev-month');
        const nextMonthBtn = document.getElementById('btn-next-month');
        
        if (prevMonthBtn) {
            prevMonthBtn.addEventListener('click', () => this.switchMonth(-1));
        }
        if (nextMonthBtn) {
            nextMonthBtn.addEventListener('click', () => this.switchMonth(1));
        }

        // 考研年份选择器
        const editBtn = document.getElementById('btn-edit-exam-year');
        const selector = document.getElementById('home-countdown-year-selector');
        if (editBtn && selector) {
            editBtn.addEventListener('click', () => {
                selector.style.display = selector.style.display === 'none' ? 'flex' : 'none';
            });
        }
        document.querySelectorAll('.year-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const jie = parseInt(btn.dataset.year);
                localStorage.setItem('examJie', jie);
                if (selector) selector.style.display = 'none';
                this.renderHome();
            });
        });
    }

    // 格式化日期时间显示
    formatDateTime(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${y}年${m}月${d}日 ${h}:${min}`;
    }

    startReview() {
        const filterSubject = document.getElementById('review-subject').value;
        const order = document.getElementById('review-order').value;
        const dateFrom = document.getElementById('review-date-from').value;
        const dateTo = document.getElementById('review-date-to').value;

        let items = [...this.store.getAll()];

        // 时间范围筛选
        if (dateFrom) {
            const fromTs = new Date(dateFrom).getTime();
            items = items.filter(item => item.timestamp >= fromTs);
        }
        if (dateTo) {
            const toTs = new Date(dateTo).getTime();
            items = items.filter(item => item.timestamp <= toTs);
        }

        // 学科筛选
        if (filterSubject) {
            if (filterSubject.includes('::')) {
                const [subject, subSubject] = filterSubject.split('::');
                items = items.filter(item => {
                    if (item.subject !== subject) return false;
                    const displaySub = this.getDisplaySubSubject(item);
                    return displaySub && displaySub.toLowerCase() === subSubject.toLowerCase();
                });
            } else {
                items = items.filter(item => item.subject === filterSubject);
            }
        }

        // 排序
        if (order === 'time-asc') {
            items.sort((a, b) => a.timestamp - b.timestamp);
        } else if (order === 'time-desc') {
            items.sort((a, b) => b.timestamp - a.timestamp);
        } else {
            // 随机
            for (let i = items.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [items[i], items[j]] = [items[j], items[i]];
            }
        }

        if (items.length === 0) {
            document.getElementById('review-area').style.display = 'none';
            document.getElementById('review-empty').style.display = '';
            return;
        }

        this.reviewItems = items;
        this.reviewIndex = 0;
        document.getElementById('review-area').style.display = '';
        document.getElementById('review-empty').style.display = 'none';
        this.renderReviewCard();
    }

    reviewNav(direction) {
        const newIndex = this.reviewIndex + direction;
        if (newIndex < 0 || newIndex >= this.reviewItems.length) return;
        this.reviewIndex = newIndex;
        this.renderReviewCard();
    }

    shuffleReview() {
        const items = this.reviewItems;
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }
        this.reviewIndex = 0;
        this.renderReviewCard();
    }

    renderReviewCard() {
        const item = this.reviewItems[this.reviewIndex];
        const total = this.reviewItems.length;
        const current = this.reviewIndex + 1;

        // 进度
        document.getElementById('review-progress-text').textContent = `${current} / ${total}`;
        document.getElementById('review-progress-fill').style.width = `${(current / total) * 100}%`;

        // 学科标签
        const tagEl = document.getElementById('review-subject-tag');
        tagEl.textContent = item.subject + (this.getDisplaySubSubject(item) ? ' · ' + this.getDisplaySubSubject(item) : '');
        tagEl.className = 'knowledge-subject-tag ' + getSubjectClass(item.subject);

        // 知识点分类
        document.getElementById('review-topic').textContent = item.topic || '';

        // 内容
        document.getElementById('review-content').textContent = item.content || '（图片知识点）';

        // 图片
        const imagesEl = document.getElementById('review-images');
        if (item.images && item.images.length > 0) {
            imagesEl.innerHTML = item.images.map(img => `<img src="${img}" alt="附图" onclick="window.open('${img}')">`).join('');
            imagesEl.style.display = '';
        } else {
            imagesEl.innerHTML = '';
            imagesEl.style.display = 'none';
        }

        // 备注
        const noteEl = document.getElementById('review-note');
        if (item.note) {
            noteEl.textContent = '备注：' + item.note;
            noteEl.style.display = '';
        } else {
            noteEl.style.display = 'none';
        }

        // 按钮状态
        document.getElementById('btn-review-prev').style.opacity = this.reviewIndex === 0 ? '0.4' : '1';
        document.getElementById('btn-review-next').style.opacity = this.reviewIndex === total - 1 ? '0.4' : '1';
    }

    // ===== AI 设置 =====
    bindAISettings() {
        const saveBtn = document.getElementById('btn-save-ai');
        const testBtn = document.getElementById('btn-test-ai');
        const statusEl = document.getElementById('ai-status');

        // 加载已保存的配置到表单
        const config = this.aiClient.config;
        const baseUrlInput = document.getElementById('ai-base-url');
        const apiKeyInput = document.getElementById('ai-api-key');
        const modelInput = document.getElementById('ai-model');

        if (config.baseUrl && baseUrlInput) baseUrlInput.value = config.baseUrl;
        if (config.apiKey && apiKeyInput) apiKeyInput.value = config.apiKey;
        if (config.model && modelInput) modelInput.value = config.model;

        // 保存配置
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const baseUrl = baseUrlInput ? baseUrlInput.value.trim() : '';
                const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
                const model = modelInput ? modelInput.value.trim() : '';

                if (!baseUrl || !apiKey || !model) {
                    showToast('请填写完整的 API 配置', 'warning');
                    return;
                }

                this.aiClient.saveConfig({ baseUrl, apiKey, model });
                if (statusEl) {
                    statusEl.className = 'ai-status success';
                    statusEl.textContent = '✓ 配置已保存';
                }
                showToast('AI 配置已保存', 'success');
            });
        }

        // 测试连接
        if (testBtn) {
            testBtn.addEventListener('click', async () => {
            // 先保存当前表单
            const baseUrl = document.getElementById('ai-base-url').value.trim();
            const apiKey = document.getElementById('ai-api-key').value.trim();
            const model = document.getElementById('ai-model').value.trim();
            if (baseUrl && apiKey && model) {
                this.aiClient.saveConfig({ baseUrl, apiKey, model });
            }

            statusEl.className = 'ai-status success';
            statusEl.textContent = '正在测试连接...';

            try {
                const result = await this.aiClient.testConnection();
                if (statusEl) {
                    statusEl.className = 'ai-status success';
                    statusEl.textContent = `✓ 连接成功！AI 回复：${result}`;
                }
                showToast('AI 连接测试成功', 'success');
            } catch (e) {
                if (statusEl) {
                    statusEl.className = 'ai-status error';
                    statusEl.textContent = `✗ 连接失败：${e.message}`;
                }
                showToast('AI 连接测试失败', 'error');
            }
        });
        }
    }

    // ===== AI 讲解 =====
    showAIExplain(item) {
        this.aiCurrentItem = item;
        const modal = document.getElementById('ai-modal');
        const questionEl = document.getElementById('ai-question');
        const answerEl = document.getElementById('ai-answer');
        const explainBtn = document.getElementById('btn-ai-explain');
        const similarBtn = document.getElementById('btn-ai-similar-check');

        // 显示知识点内容
        const subjectLabel = item.subject + (this.getDisplaySubSubject(item) ? ' · ' + this.getDisplaySubSubject(item) : '');
        questionEl.innerHTML = `<strong>${this.escapeHtml(subjectLabel)}</strong> · ${this.escapeHtml(item.topic || '未分类')}<br><br>${this.escapeHtml(item.content) || '（图片知识点）'}`;

        // 重置回答区域
        answerEl.innerHTML = '<p class="ai-empty">点击「开始讲解」让 AI 帮你理解这个知识点</p>';
        explainBtn.style.display = '';
        explainBtn.textContent = '开始讲解';
        similarBtn.style.display = 'none';

        modal.classList.add('active');
    }

    async doAIExplain() {
        if (!this.aiCurrentItem) return;
        if (!this.aiClient.isConfigured()) {
            showToast('请先在 AI 设置中配置 API', 'warning');
            return;
        }

        const answerEl = document.getElementById('ai-answer');
        const explainBtn = document.getElementById('btn-ai-explain');

        // 显示加载状态
        answerEl.innerHTML = '<div class="ai-loading"><span class="ai-loading-dot"></span><span class="ai-loading-dot"></span><span class="ai-loading-dot"></span><span>AI 正在思考...</span></div>';
        explainBtn.disabled = true;
        explainBtn.textContent = '讲解中...';

        try {
            const result = await this.aiClient.explainKnowledge(this.aiCurrentItem);
            answerEl.innerHTML = `<p>${this.escapeHtml(this.cleanMarkdown(result))}</p>`;
            explainBtn.textContent = '重新讲解';
        } catch (e) {
            answerEl.innerHTML = `<p style="color:var(--text-light);">讲解失败：${this.escapeHtml(e.message)}</p>`;
            explainBtn.textContent = '重试';
        } finally {
            explainBtn.disabled = false;
        }
    }

    // ===== AI 辅助查重 =====
    async doAIDuplicateCheck() {
        if (!this.pendingItem) return;
        if (!this.aiClient.isConfigured()) {
            showToast('请先在 AI 设置中配置 API', 'warning');
            return;
        }

        const listEl = document.getElementById('duplicate-list');
        const newContent = this.pendingItem.content;

        // 找到所有重复项，逐个用 AI 判断
        const dupItems = listEl.querySelectorAll('.duplicate-item');
        const dupData = [];
        dupItems.forEach(el => {
            const id = el.dataset.dupId;
            const item = this.store.getById(id);
            if (item) dupData.push({ el, item });
        });

        // 显示加载状态
        dupItems.forEach(el => {
            const existing = el.querySelector('.ai-verdict');
            if (existing) existing.remove();
        });

        showToast('AI 正在分析...', 'info');

        for (const { el, item } of dupData) {
            try {
                const result = await this.aiClient.checkSimilarity(newContent, item.content);
                const verdictDiv = document.createElement('div');
                verdictDiv.className = 'ai-verdict similar';
                verdictDiv.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px;"><path d="M12 2a4 4 0 0 1 4 4v1a1 1 0 0 0 1 1h1a4 4 0 0 1 0 8h-1a1 1 0 0 0-1 1v1a4 4 0 0 1-8 0v-1a1 1 0 0 0-1-1H6a4 4 0 0 1 0-8h1a1 1 0 0 0 1-1V6a4 4 0 0 1 4-4z"/><circle cx="12" cy="12" r="2"/></svg>${result}`;
                el.appendChild(verdictDiv);
            } catch (e) {
                const verdictDiv = document.createElement('div');
                verdictDiv.className = 'ai-verdict different';
                verdictDiv.textContent = `AI 判断失败：${e.message}`;
                el.appendChild(verdictDiv);
            }
        }
    }

    // ===== 弹窗控制 =====
    bindModals() {
        try {
            console.log('[bindModals] 开始绑定弹窗事件');

            // 重复提醒弹窗
            const cancelAddBtn = document.getElementById('btn-cancel-add');
            const forceAddBtn = document.getElementById('btn-force-add');
            console.log('[bindModals] btn-cancel-add:', cancelAddBtn);
            console.log('[bindModals] btn-force-add:', forceAddBtn);
            if (cancelAddBtn) cancelAddBtn.addEventListener('click', () => {
                const modal = document.getElementById('duplicate-modal');
                if (modal) modal.classList.remove('active');
                this.pendingItem = null;
            });

            if (forceAddBtn) forceAddBtn.addEventListener('click', () => {
                if (this.pendingItem) {
                    this.saveKnowledgePoint(this.pendingItem);
                    this.pendingItem = null;
                }
                const modal = document.getElementById('duplicate-modal');
                if (modal) modal.classList.remove('active');
            });

            // 详情弹窗
            const closeDetailBtn = document.getElementById('close-detail');
            console.log('[bindModals] close-detail 按钮:', closeDetailBtn);
            if (closeDetailBtn) {
                closeDetailBtn.addEventListener('click', () => {
                    console.log('[bindModals] 点击关闭详情按钮');
                    const modal = document.getElementById('detail-modal');
                    if (modal) {
                        modal.classList.remove('active');
                        console.log('[bindModals] 已关闭详情弹窗');
                    }
                });
            }

            // 详情弹窗删除按钮（动态绑定，因为按钮是动态生成的）
            document.addEventListener('click', (e) => {
                const deleteBtn = e.target.closest('#btn-delete-detail');
                if (deleteBtn) {
                    console.log('[bindModals] 点击删除按钮, data-id:', deleteBtn.dataset.id);
                    const id = deleteBtn.dataset.id;
                    if (id && confirm('确定要删除这个知识点吗？')) {
                        this.store.remove(id);
                        const modal = document.getElementById('detail-modal');
                        if (modal) modal.classList.remove('active');
                        this.renderKnowledgeList();
                        showToast('已删除', 'info');
                        console.log('[bindModals] 已删除知识点:', id);
                    }
                }
            });

            // 点击遮罩关闭弹窗
            document.querySelectorAll('.modal-overlay').forEach(overlay => {
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) {
                        overlay.classList.remove('active');
                        this.pendingItem = null;
                    }
                });
            });

            // AI 讲解弹窗
            const closeAiBtn = document.getElementById('close-ai');
            const aiExplainBtn = document.getElementById('btn-ai-explain');
            const aiDupCheckBtn = document.getElementById('btn-ai-dup-check');

            if (closeAiBtn) closeAiBtn.addEventListener('click', () => {
                const modal = document.getElementById('ai-modal');
                if (modal) modal.classList.remove('active');
                this.aiCurrentItem = null;
            });
            if (aiExplainBtn) aiExplainBtn.addEventListener('click', () => this.doAIExplain());

            // AI 辅助查重按钮
            if (aiDupCheckBtn) aiDupCheckBtn.addEventListener('click', () => this.doAIDuplicateCheck());
            
            console.log('[bindModals] 所有弹窗事件绑定完成');
        } catch (error) {
            console.error('[bindModals] 绑定失败:', error);
        }
    }

    // 获取显示用的子科目名称（兼容旧数据）
    getDisplaySubSubject(item) {
        // 新数据：直接使用 subSubject 字段
        if (item.subSubject) return item.subSubject;
        // 旧数据：如果 topic 包含某个已知子科目名称（不区分大小写），就用它
        if (item.subject === '专业课' && item.topic && item.topic !== '未分类') {
            const topicLower = item.topic.toLowerCase();
            const matched = this.subSubjects.find(s => topicLower.includes(s.toLowerCase()));
            if (matched) return matched;
        }
        return null;
    }

    // ===== 辅助方法 =====
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 清理 AI 返回的 Markdown 格式，只保留纯文本和段落分行
    cleanMarkdown(text) {
        if (!text) return '';
        let cleaned = text;
        // 去掉标题标记 # ## ###
        cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
        // 去掉加粗 **text** 和 *text*，保留内容
        cleaned = cleaned.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
        // 去掉行内代码 `code`
        cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
        // 去掉列表标记 - * + 开头的，保留文字
        cleaned = cleaned.replace(/^[\-\*\+]\s+/gm, '');
        // 去掉数字列表标记 1. 2. 等
        cleaned = cleaned.replace(/^\d+\.\s+/gm, '');
        // 去掉引用标记 >
        cleaned = cleaned.replace(/^>\s+/gm, '');
        // 去掉水平分割线 --- ***
        cleaned = cleaned.replace(/^\s*[\-\*]{3,}\s*$/gm, '');
        // 去掉多余空行（连续3个以上换行合并为2个）
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
        return cleaned.trim();
    }
}

// ===== 启动应用 =====
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new App();
    console.log('[App] 应用已初始化');
    
    // 全局调试函数
    window.testCloseModal = function() {
        const modal = document.getElementById('detail-modal');
        if (modal) {
            modal.classList.remove('active');
            console.log('[Test] 手动关闭详情弹窗成功');
        } else {
            console.log('[Test] 未找到 detail-modal 元素');
        }
    };
});
