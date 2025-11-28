// ONNX Runtime Web のインポート
let ort;

// アプリケーションの状態管理
class BrowserInferApp {
    constructor() {
        this.session = null;
        this.tokenizer = null;
        this.chatHistory = [];
        this.isGenerating = false;
        this.vocabMap = null;
        this.reverseVocab = null;
        
        this.init();
    }

    async init() {
        this.setupUIElements();
        await this.checkWebGPUSupport();
        this.setupEventListeners();
    }

    setupUIElements() {
        this.elements = {
            webgpuIndicator: document.getElementById('webgpu-indicator'),
            modelIndicator: document.getElementById('model-indicator'),
            errorMessage: document.getElementById('error-message'),
            chatMessages: document.getElementById('chat-messages'),
            userInput: document.getElementById('user-input'),
            sendButton: document.getElementById('send-button'),
            clearCacheButton: document.getElementById('clear-cache-button')
        };
    }

    async checkWebGPUSupport() {
        console.log('WebGPU対応チェック開始');
        
        if (!navigator.gpu) {
            this.showWebGPUError('WebGPU非対応', 'WebGPU 対応ブラウザ（Chrome 113+ / Edge 113+ 等）が必要です');
            return;
        }

        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                this.showWebGPUError('WebGPUアダプタなし', 'WebGPU アダプタが取得できませんでした');
                return;
            }

            const device = await adapter.requestDevice();
            if (!device) {
                this.showWebGPUError('WebGPUデバイスなし', 'WebGPU デバイスが取得できませんでした');
                return;
            }

            this.updateWebGPUStatus('supported', 'サポート済み');
            console.log('WebGPU対応確認完了');
            
            // WebGPU対応確認後、モデルロードを開始
            await this.loadModel();
            
        } catch (error) {
            console.error('WebGPU初期化エラー:', error);
            this.showWebGPUError('WebGPU初期化失敗', `WebGPU の初期化に失敗しました: ${error.message}`);
        }
    }

    showWebGPUError(status, message) {
        this.updateWebGPUStatus('not-supported', status);
        this.showError(message);
    }

    updateWebGPUStatus(className, text) {
        this.elements.webgpuIndicator.className = `status-indicator ${className}`;
        this.elements.webgpuIndicator.textContent = text;
    }

    updateModelStatus(className, text) {
        this.elements.modelIndicator.className = `status-indicator ${className}`;
        this.elements.modelIndicator.textContent = text;
    }

    showError(message) {
        this.elements.errorMessage.textContent = message;
        this.elements.errorMessage.classList.remove('hidden');
    }

    hideError() {
        this.elements.errorMessage.classList.add('hidden');
    }

    // ONNX Runtime Web の読み込み待機
    async waitForOrt() {
        const maxWait = 10000; // 10秒でタイムアウト
        const interval = 100;
        let waited = 0;

        while (typeof window.ort === 'undefined' && waited < maxWait) {
            await new Promise(resolve => setTimeout(resolve, interval));
            waited += interval;
        }

        if (typeof window.ort === 'undefined') {
            console.log('HTMLスクリプトでの読み込み失敗、dynamic importを試行...');
            try {
                const ortModule = await import('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js');
                window.ort = ortModule.default || ortModule;
                
                if (typeof window.ort === 'undefined') {
                    throw new Error('Dynamic importでも読み込み失敗');
                }
            } catch (error) {
                throw new Error(`ONNX Runtime Web の読み込みに失敗しました: ${error.message}`);
            }
        }
    }

    async loadModel() {
        try {
            console.log('モデルロード開始');
            this.updateModelStatus('loading', 'ONNX Runtime Web読み込み中...');
            this.hideError();

            // ONNX Runtime Web の読み込み待機
            await this.waitForOrt();
            
            // WebGPU用のWASMパスを設定
            window.ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
            console.log('ONNX Runtime Web読み込み完了');

            this.updateModelStatus('loading', 'モデルファイルダウンロード中...');

            // Phi-3モデル（ONNX Runtime Web直接でExternal data正しく処理）
            const modelUrl = 'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-onnx-web/resolve/main/onnx/model_q4f16.onnx';
            const modelDataUrl = 'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-onnx-web/resolve/main/onnx/model_q4f16.onnx_data';

            // IndexedDBからキャッシュを確認
            const cachedFiles = await this.getCachedModel();
            let modelArrayBuffer, modelDataArrayBuffer;

            if (cachedFiles && cachedFiles.model && cachedFiles.data) {
                console.log('キャッシュからモデルロード');
                modelArrayBuffer = cachedFiles.model;
                modelDataArrayBuffer = cachedFiles.data;
            } else {
                console.log('Hugging FaceからPhi-3モデルダウンロード開始');
                
                // モデルとExternal dataを並列ダウンロード
                const [modelResponse, modelDataResponse] = await Promise.all([
                    fetch(modelUrl),
                    fetch(modelDataUrl)
                ]);

                if (!modelResponse.ok || !modelDataResponse.ok) {
                    throw new Error(`モデルファイルのダウンロードに失敗しました: Model:${modelResponse.status}, Data:${modelDataResponse.status}`);
                }

                // ArrayBufferとして取得
                [modelArrayBuffer, modelDataArrayBuffer] = await Promise.all([
                    modelResponse.arrayBuffer(),
                    modelDataResponse.arrayBuffer()
                ]);

                const modelMB = Math.round(modelArrayBuffer.byteLength / 1024 / 1024);
                const dataMB = Math.round(modelDataArrayBuffer.byteLength / 1024 / 1024);
                console.log(`Phi-3モデルダウンロード完了 (Model:${modelMB}MB, Data:${dataMB}MB)`);
                
                // IndexedDBにキャッシュ（両ファイル）
                try {
                    await this.cacheModel(modelArrayBuffer, modelDataArrayBuffer);
                    console.log('Phi-3モデルをIndexedDBにキャッシュしました');
                } catch (cacheError) {
                    console.warn('キャッシュに失敗、続行します:', cacheError.message);
                }
            }

            // ONNX Runtime Web - External data正しい処理
            console.log('ONNX Runtime Web External data処理設定中...');
            
            // WASMパスを設定
            window.ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
            
            // External dataの正しい処理方法
            // ONNX Runtime Webでは、modelArrayBufferと一緒にexternal dataを渡す
            // Blob URLを作成してファイル参照を可能にする
            const modelDataBlob = new Blob([modelDataArrayBuffer]);
            const modelDataBlobUrl = URL.createObjectURL(modelDataBlob);
            
            // セッション作成時にExternal dataのコンテキストを提供
            this.sessionOptions = {
                executionProviders: ['webgpu'],
                graphOptimizationLevel: 'basic',
                enableCpuMemArena: false,
                enableMemPattern: false,
                // External dataファイルのマッピング（ONNX Runtime Web API）
                externalData: [
                    {
                        path: 'model_q4f16.onnx_data',
                        data: modelDataArrayBuffer
                    }
                ]
            };
            
            console.log('External data設定完了');

            this.updateModelStatus('loading', 'ONNX Runtimeセッション作成中...');

            // ONNX Runtime セッション作成
            console.log('ONNX Runtimeセッション作成中...');
            
            this.session = await window.ort.InferenceSession.create(modelArrayBuffer, this.sessionOptions);

            console.log('セッション作成完了');

            // Phi-3用トークナイザロード
            await this.loadPhi3Tokenizer();

            this.updateModelStatus('ready', '準備完了');
            this.enableUI();
            console.log('モデルロード完了');

        } catch (error) {
            console.error('モデルロードエラー:', error);
            this.updateModelStatus('error', 'ロード失敗');
            this.showError(`モデルの読み込みに失敗しました: ${error.message}`);
        }
    }

    async getCachedModel() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('BrowserInferDB', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('models')) {
                    resolve(null);
                    return;
                }
                
                const transaction = db.transaction(['models'], 'readonly');
                const store = transaction.objectStore('models');
                const getRequest = store.get('phi3-model');
                
                getRequest.onerror = () => reject(getRequest.error);
                getRequest.onsuccess = async () => {
                    const result = getRequest.result;
                    if (result && result.modelChunks && result.dataChunks) {
                        // モデルとExternal dataの両方の分割キャッシュからの復元
                        try {
                            const modelChunks = [];
                            const dataChunks = [];
                            
                            // モデルチャンクを読み込み
                            for (let i = 0; i < result.modelChunks; i++) {
                                const chunkRequest = store.get(`phi3-model-chunk-${i}`);
                                const chunk = await new Promise((resolveChunk, rejectChunk) => {
                                    chunkRequest.onerror = () => rejectChunk(chunkRequest.error);
                                    chunkRequest.onsuccess = () => resolveChunk(chunkRequest.result);
                                });
                                if (chunk && chunk.data) {
                                    modelChunks.push(chunk.data);
                                } else {
                                    throw new Error(`モデルチャンク${i}が見つかりません`);
                                }
                            }
                            
                            // External dataチャンクを読み込み
                            for (let i = 0; i < result.dataChunks; i++) {
                                const chunkRequest = store.get(`phi3-data-chunk-${i}`);
                                const chunk = await new Promise((resolveChunk, rejectChunk) => {
                                    chunkRequest.onerror = () => rejectChunk(chunkRequest.error);
                                    chunkRequest.onsuccess = () => resolveChunk(chunkRequest.result);
                                });
                                if (chunk && chunk.data) {
                                    dataChunks.push(chunk.data);
                                } else {
                                    throw new Error(`データチャンク${i}が見つかりません`);
                                }
                            }
                            
                            // モデルチャンクを結合
                            const modelBuffer = new ArrayBuffer(result.modelSize);
                            const modelView = new Uint8Array(modelBuffer);
                            let modelOffset = 0;
                            for (const chunk of modelChunks) {
                                const chunkView = new Uint8Array(chunk);
                                modelView.set(chunkView, modelOffset);
                                modelOffset += chunk.byteLength;
                            }
                            
                            // External dataチャンクを結合
                            const dataBuffer = new ArrayBuffer(result.dataSize);
                            const dataView = new Uint8Array(dataBuffer);
                            let dataOffset = 0;
                            for (const chunk of dataChunks) {
                                const chunkView = new Uint8Array(chunk);
                                dataView.set(chunkView, dataOffset);
                                dataOffset += chunk.byteLength;
                            }
                            
                            console.log(`キャッシュからモデル復元完了 (Model:${Math.round(result.modelSize/1024/1024)}MB, Data:${Math.round(result.dataSize/1024/1024)}MB)`);
                            resolve({ model: modelBuffer, data: dataBuffer });
                        } catch (error) {
                            console.error('キャッシュ復元エラー:', error);
                            resolve(null);
                        }
                    } else {
                        console.log('キャッシュが見つかりません');
                        resolve(null);
                    }
                };
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('models')) {
                    db.createObjectStore('models', { keyPath: 'id' });
                }
            };
        });
    }

    async cacheModel(modelBuffer, modelDataBuffer) {
        const chunkSize = 50 * 1024 * 1024; // 50MBずつ分割
        
        return new Promise(async (resolve, reject) => {
            try {
                const request = indexedDB.open('BrowserInferDB', 1);
                
                request.onerror = () => reject(request.error);
                request.onsuccess = async () => {
                    const db = request.result;
                    const transaction = db.transaction(['models'], 'readwrite');
                    const store = transaction.objectStore('models');
                    
                    // モデルファイルを分割保存
                    const modelChunks = [];
                    const dataChunks = [];
                    
                    for (let i = 0; i < modelBuffer.byteLength; i += chunkSize) {
                        modelChunks.push(modelBuffer.slice(i, i + chunkSize));
                    }
                    
                    for (let i = 0; i < modelDataBuffer.byteLength; i += chunkSize) {
                        dataChunks.push(modelDataBuffer.slice(i, i + chunkSize));
                    }
                    
                    // メタデータを保存
                    const putRequest = store.put({
                        id: 'phi3-model',
                        modelChunks: modelChunks.length,
                        dataChunks: dataChunks.length,
                        modelSize: modelBuffer.byteLength,
                        dataSize: modelDataBuffer.byteLength,
                        timestamp: Date.now()
                    });
                    
                    putRequest.onsuccess = async () => {
                        // チャンクを個別に保存
                        for (let i = 0; i < modelChunks.length; i++) {
                            await new Promise((resolveChunk, rejectChunk) => {
                                const chunkRequest = store.put({
                                    id: `phi3-model-chunk-${i}`,
                                    data: modelChunks[i],
                                    type: 'model'
                                });
                                chunkRequest.onerror = () => rejectChunk(chunkRequest.error);
                                chunkRequest.onsuccess = () => resolveChunk();
                            });
                        }
                        
                        for (let i = 0; i < dataChunks.length; i++) {
                            await new Promise((resolveChunk, rejectChunk) => {
                                const chunkRequest = store.put({
                                    id: `phi3-data-chunk-${i}`,
                                    data: dataChunks[i],
                                    type: 'data'
                                });
                                chunkRequest.onerror = () => rejectChunk(chunkRequest.error);
                                chunkRequest.onsuccess = () => resolveChunk();
                            });
                        }
                        
                        resolve();
                    };
                    
                    putRequest.onerror = () => reject(putRequest.error);
                };
                
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains('models')) {
                        db.createObjectStore('models', { keyPath: 'id' });
                    }
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    async cacheSingleModel(modelBuffer) {
        const chunkSize = 50 * 1024 * 1024; // 50MBずつ分割
        
        return new Promise(async (resolve, reject) => {
            try {
                const request = indexedDB.open('BrowserInferDB', 1);
                
                request.onerror = () => reject(request.error);
                request.onsuccess = async () => {
                    const db = request.result;
                    const transaction = db.transaction(['models'], 'readwrite');
                    const store = transaction.objectStore('models');
                    
                    // モデルファイルを分割保存
                    const modelChunks = [];
                    
                    for (let i = 0; i < modelBuffer.byteLength; i += chunkSize) {
                        modelChunks.push(modelBuffer.slice(i, i + chunkSize));
                    }
                    
                    // メタデータを保存
                    const putRequest = store.put({
                        id: 'phi35-model',
                        modelChunks: modelChunks.length,
                        modelSize: modelBuffer.byteLength,
                        timestamp: Date.now()
                    });
                    
                    putRequest.onsuccess = async () => {
                        // チャンクを個別に保存
                        for (let i = 0; i < modelChunks.length; i++) {
                            await new Promise((resolveChunk, rejectChunk) => {
                                const chunkRequest = store.put({
                                    id: `phi35-model-chunk-${i}`,
                                    data: modelChunks[i],
                                    type: 'model'
                                });
                                chunkRequest.onerror = () => rejectChunk(chunkRequest.error);
                                chunkRequest.onsuccess = () => resolveChunk();
                            });
                        }
                        
                        resolve();
                    };
                    
                    putRequest.onerror = () => reject(putRequest.error);
                };
                
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains('models')) {
                        db.createObjectStore('models', { keyPath: 'id' });
                    }
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    async loadPhi3Tokenizer() {
        try {
            console.log('Phi-3トークナイザロード中...');
            
            // Transformers.jsを動的インポート
            const { AutoTokenizer } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js');
            
            // Transformers.jsのトークナイザを読み込み（推論とは分離）
            this.tokenizer = await AutoTokenizer.from_pretrained('microsoft/Phi-3-mini-4k-instruct', {
                legacy: false
            });
            
            // この終了トークン候補をtokenizerから素直に集めておく
            this.eosIds = [];
            if (this.tokenizer.eos_token_id != null) {
                this.eosIds.push(this.tokenizer.eos_token_id);
            }
            if (this.tokenizer.eos_token_ids && Array.isArray(this.tokenizer.eos_token_ids)) {
                this.eosIds.push(...this.tokenizer.eos_token_ids);
            }
            
            // Phi-3特殊トークン設定
            this.specialTokens = {
                bosToken: '<|endoftext|>',
                eosToken: '<|endoftext|>',
                systemStart: '<|system|>',
                systemEnd: '<|end|>',
                userStart: '<|user|>',
                userEnd: '<|end|>',
                assistantStart: '<|assistant|>',
                assistantEnd: '<|end|>',
                eosTokenId: this.tokenizer.eos_token_id
            };
            
            console.log('Phi-3トークナイザロード完了（Transformers.js動的インポート、推論は分離）');
            console.log('EOS Token IDs:', this.eosIds);
        } catch (error) {
            console.error('トークナイザロードエラー:', error);
            throw new Error(`トークナイザの読み込みに失敗しました: ${error.message}`);
        }
    }

    enableUI() {
        this.elements.userInput.disabled = false;
        this.elements.sendButton.disabled = false;
        this.elements.userInput.placeholder = "メッセージを入力してください...";
    }

    setupEventListeners() {
        this.elements.sendButton.addEventListener('click', () => this.sendMessage());
        this.elements.clearCacheButton.addEventListener('click', () => this.clearCache());
        
        // 日本語入力対応: keydownの代わりにkeyupを使用し、isComposingをチェック
        this.elements.userInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // IME入力状態を追跡
        this.isComposing = false;
        this.elements.userInput.addEventListener('compositionstart', () => {
            this.isComposing = true;
        });
        this.elements.userInput.addEventListener('compositionend', () => {
            this.isComposing = false;
        });
    }

    async clearCache() {
        try {
            console.log('キャッシュクリア開始');
            this.elements.clearCacheButton.disabled = true;
            this.elements.clearCacheButton.textContent = 'クリア中...';

            // IndexedDBからモデルキャッシュを削除
            await new Promise((resolve, reject) => {
                const request = indexedDB.open('BrowserInferDB', 1);
                
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains('models')) {
                        resolve();
                        return;
                    }
                    
                    const transaction = db.transaction(['models'], 'readwrite');
                    const store = transaction.objectStore('models');
                    const deleteRequest = store.delete('phi3-model');
                    
                    deleteRequest.onerror = () => reject(deleteRequest.error);
                    deleteRequest.onsuccess = () => resolve();
                };
            });

            // セッションと状態をリセット
            this.session = null;
            this.tokenizer = null;
            this.updateModelStatus('loading', '未ロード');
            this.elements.userInput.disabled = true;
            this.elements.sendButton.disabled = true;
            this.elements.userInput.placeholder = "モデルロード中...";

            // チャット履歴もクリア
            this.chatHistory = [];
            this.elements.chatMessages.innerHTML = '';

            console.log('キャッシュクリア完了');
            alert('キャッシュをクリアしました。ページをリロードしてモデルを再ダウンロードします。');
            
            // ページをリロードして再初期化
            window.location.reload();

        } catch (error) {
            console.error('キャッシュクリアエラー:', error);
            alert(`キャッシュクリアに失敗しました: ${error.message}`);
        } finally {
            this.elements.clearCacheButton.disabled = false;
            this.elements.clearCacheButton.textContent = 'キャッシュクリア';
        }
    }

    async sendMessage() {
        const message = this.elements.userInput.value.trim();
        if (!message || this.isGenerating || !this.session) {
            return;
        }

        // IME入力中は送信しない
        if (this.isComposing) {
            return;
        }

        // 最初に確実にクリア
        this.elements.userInput.value = '';
        
        this.isGenerating = true;
        this.elements.sendButton.disabled = true;

        // ユーザーメッセージを表示
        this.addMessage(message, 'user');
        
        // 生成中メッセージを表示
        const thinkingMessage = this.addMessage('生成中...', 'thinking');

        try {
            // LLM推論を実行
            const response = await this.generateResponse(message);
            
            // 考え中メッセージを削除
            thinkingMessage.remove();
            
            // アシスタントの返答を表示
            this.addMessage(response, 'assistant');
            
        } catch (error) {
            console.error('推論エラー:', error);
            thinkingMessage.remove();
            this.addMessage(`エラーが発生しました: ${error.message}`, 'assistant');
        } finally {
            this.isGenerating = false;
            this.elements.sendButton.disabled = false;
        }
    }

    addMessage(content, type) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${type}`;
        messageElement.textContent = content;
        
        this.elements.chatMessages.appendChild(messageElement);
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
        
        return messageElement;
    }

    // Transformers.jsトークナイザを使用（chat_template経由）
    async encodePhi3Text(text) {
        const systemPrompt =
            "You are a friendly Japanese chat assistant. " +
            "Always reply in Japanese only. " +
            "Answer briefly (1–2 sentences). " +
            "Do NOT explain your task or output patterns like『指示1』『指示2』.";

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: text },
        ];

        // ★ ここで chat_template を使う
        const result = await this.tokenizer.apply_chat_template(
            messages,
            {
                tokenize: true,
                add_generation_prompt: true, // <|assistant|> まで
                // return_tensor は false にして「生の配列/TypedArray」にしておく
            }
        );

        // result の型に応じて input_ids を取り出す
        let ids;
        if (Array.isArray(result)) {
            ids = result;
        } else if (result.input_ids) {
            // Transformers.js が { input_ids, attention_mask, ... } を返すパターン
            ids = result.input_ids;
        } else if (result.data) {
            // BigInt64Array や Tensorっぽい場合
            ids = result.data;
        } else {
            throw new Error('Unexpected chat_template result: ' + JSON.stringify(result));
        }

        // BigInt → Number に揃えて Int32Array にする
        const intIds = Int32Array.from(ids, x => Number(x));

        console.log('Phi-3エンコード結果 (先頭20):', Array.from(intIds.slice(0, 20)), 'total:', intIds.length);

        this.promptLength = intIds.length;           // ここは intIds.length でOK
        return intIds;                               // ★ Int32Array を返す
    }


    // Transformers.jsでデコード処理（生成部分のみ）
    decodeTokens(tokenIds) {
        // 生成されたトークンのみをデコード（特殊トークンをスキップ）
        let text = this.tokenizer.decode(tokenIds, { 
            skip_special_tokens: true,
            clean_up_tokenization_spaces: true 
        });
        
        // 「指示1」「指示2」などの訓練データパターンを除去
        text = text.replace(/指示[0-9]+[：:]/g, '');
        text = text.replace(/\n\n指示[0-9]+.*$/gs, '');
        
        // 最初の文のみを抽出（改行や句点で区切る）
        const sentences = text.split(/[。\n]/);
        text = sentences.find(s => s.trim().length > 0) || text;
        
        console.log('デコード結果:', text);
        
        return text.trim();
    }

    // Float16テンソル作成ヘルパー関数
    createFloat16Tensor(data, shape) {
        // Float32ArrayからFloat16Arrayに変換
        const float16Data = new Float16Array(data.length);
        for (let i = 0; i < data.length; i++) {
            float16Data[i] = data[i]; // 自動的にfp16に変換される
        }
        return new window.ort.Tensor('float16', float16Data, shape);
    }

    async generateResponse(userMessage) {
        try {
            console.log('推論開始:', userMessage);
            
            // テキストをPhi-3形式でエンコード
            let currentTokens = await this.encodePhi3Text(userMessage);
            let generatedTokens = [];
            
            // EOSトークンID（Phi-3）
            const eosTokenId = this.specialTokens.eosTokenId;
            const maxTokens = 64; // 最大生成トークン数（短縮）
            
            console.log('EOSトークンID:', eosTokenId);
            console.log('All EOS IDs:', this.eosIds);
            
            // past_key_valuesを初期化
            let pastKeyValues = {};
            for (let i = 0; i < 32; i++) {
                const emptyData = new Float32Array(0);
                pastKeyValues[`past_key_values.${i}.key`] = this.createFloat16Tensor(emptyData, [1, 32, 0, 96]);
                pastKeyValues[`past_key_values.${i}.value`] = this.createFloat16Tensor(emptyData, [1, 32, 0, 96]);
            }
            
            console.log(`初期入力トークン数: ${currentTokens.length}`);
            
            // 自動回帰的テキスト生成ループ
            for (let step = 0; step < maxTokens; step++) {
                let inputTensor, attentionMask, positionTensor;
                
                if (step === 0) {
                    // 初回推論: 全シーケンスを処理
                    const sequenceLength = currentTokens.length;
                    
                    const inputTokens64 = new BigInt64Array(currentTokens.length);
                    for (let i = 0; i < currentTokens.length; i++) {
                        inputTokens64[i] = BigInt(currentTokens[i]);
                    }
                    inputTensor = new window.ort.Tensor('int64', inputTokens64, [1, sequenceLength]);
                    
                    const attentionMask64 = new BigInt64Array(sequenceLength).fill(1n);
                    attentionMask = new window.ort.Tensor('int64', attentionMask64, [1, sequenceLength]);
                    
                    const positionIds64 = new BigInt64Array(sequenceLength);
                    for (let i = 0; i < sequenceLength; i++) {
                        positionIds64[i] = BigInt(i);
                    }
                    positionTensor = new window.ort.Tensor('int64', positionIds64, [1, sequenceLength]);
                } else {
                    // 2回目以降: 新しいトークンのみ処理
                    const lastTokenId = currentTokens[currentTokens.length - 1];
                    inputTensor = new window.ort.Tensor('int64', new BigInt64Array([BigInt(lastTokenId)]), [1, 1]);
                    
                    // attention_maskは累積シーケンス長に対応
                    const totalLength = currentTokens.length;
                    const attentionMask64 = new BigInt64Array(totalLength).fill(1n);
                    attentionMask = new window.ort.Tensor('int64', attentionMask64, [1, totalLength]);
                    
                    // position_idsは現在の位置
                    const currentPos = currentTokens.length - 1;
                    positionTensor = new window.ort.Tensor('int64', new BigInt64Array([BigInt(currentPos)]), [1, 1]);
                }
                
                // セッション実行用のfeeds
                const feeds = {
                    input_ids: inputTensor,
                    attention_mask: attentionMask,
                    position_ids: positionTensor,
                    ...pastKeyValues
                };
                
                console.log(`ステップ ${step + 1}: 推論実行中... (tokens: ${currentTokens.length})`);
                const results = await this.session.run(feeds);
                
                // 出力から次のトークンを取得
                const logits = results.logits.data;
                const vocabSize = results.logits.dims[results.logits.dims.length - 1];
                
                // 最後のトークンの位置のlogitsを取得
                const lastTokenLogits = logits.slice(-vocabSize);
                
                // 最も確率の高いトークンを選択（greedy sampling）
                let maxProb = -Infinity;
                let nextTokenId = 0;
                
                for (let i = 0; i < lastTokenLogits.length; i++) {
                    if (lastTokenLogits[i] > maxProb) {
                        maxProb = lastTokenLogits[i];
                        nextTokenId = i;
                    }
                }
                
                console.log(`生成トークン ${step + 1}: ID=${nextTokenId}`);
                
                // EOSトークンチェック（tokenizer由来のIDだけを見る）
                if (Array.isArray(this.eosIds) && this.eosIds.includes(nextTokenId)) {
                    console.log(`EOSトークン(${nextTokenId})で生成終了`);
                    break;
                }

                // 追加の早期終了（<|end|> を素で出したときだけ）
                const tokenPiece = this.tokenizer.decode([nextTokenId], { skip_special_tokens: false });
                if (tokenPiece.includes('<|end|>')) {
                    console.log(`特殊トークン(${tokenPiece})で生成終了`);
                    break;
                }

                // ★ ここでは '\n' や '。' は見ない ★
                
                // 生成されたトークンを追加
                generatedTokens.push(nextTokenId);
                currentTokens = [...currentTokens, nextTokenId];
                
                // past_key_valuesを更新（次回推論のため）
                for (let i = 0; i < 32; i++) {
                    if (results[`present.${i}.key`]) {
                        pastKeyValues[`past_key_values.${i}.key`] = results[`present.${i}.key`];
                    }
                    if (results[`present.${i}.value`]) {
                        pastKeyValues[`past_key_values.${i}.value`] = results[`present.${i}.value`];
                    }
                }
            }
            
            console.log(`生成完了: ${generatedTokens.length}トークン生成`);
            
            // 生成されたトークンのみをデコード（プロンプト部分を除外）
            const generatedText = this.decodeTokens(generatedTokens);
            console.log('生成されたテキスト:', generatedText);
            
            return generatedText || "申し訳ありませんが、応答の生成に失敗しました。";
            
        } catch (error) {
            console.error('推論エラー詳細:', error);
            throw new Error(`推論に失敗しました: ${error.message}`);
        }
    }
}

// アプリケーション開始
document.addEventListener('DOMContentLoaded', () => {
    console.log('BrowserInfer起動中...');
    window.app = new BrowserInferApp();
});