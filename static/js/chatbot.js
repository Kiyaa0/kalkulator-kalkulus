/**
 * static/js/chatbot.js
 * Asisten Tutor AI CalcKu - Frontend Controller
 * Menghubungkan antarmuka obrolan dengan /api/chat secara aman dan reaktif.
 */

(function () {
    let isChatOpen = false;
    let isLoading = false;
    let chatHistory = [];

    // Elemen DOM
    const fabBtn = document.getElementById('calcku-chat-fab');
    const widget = document.getElementById('calcku-chat-widget');
    const closeBtn = document.getElementById('chat-close-btn');
    const clearBtn = document.getElementById('chat-clear-btn');
    const messagesBody = document.getElementById('chat-messages-body');
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    const chips = document.querySelectorAll('.chat-chip');

    if (!fabBtn || !widget || !messagesBody || !chatInput || !sendBtn) {
        return;
    }

    // Toggle tampilan widget dengan dukungan tombol Back HP & riwayat peramban
    function toggleChat(open, fromPopstate) {
        if (typeof open === 'boolean') {
            isChatOpen = open;
        } else {
            isChatOpen = !isChatOpen;
        }

        if (isChatOpen) {
            widget.classList.remove('hidden');
            // Dorong riwayat virtual agar tombol Back fisik/gesture di Android menutup chat, bukan keluar web
            if (!fromPopstate) {
                try {
                    window.history.pushState({ calckuChat: true }, '');
                } catch (e) {}
            }
            setTimeout(() => {
                scrollToBottom();
            }, 50);
        } else {
            widget.classList.add('hidden');
            // Sinkronisasi riwayat jika modal ditutup melalui tombol UI (Tutup)
            if (!fromPopstate && window.history.state && window.history.state.calckuChat) {
                try {
                    window.history.back();
                } catch (e) {}
            }
        }
    }

    fabBtn.addEventListener('click', () => toggleChat(true));
    if (closeBtn) closeBtn.addEventListener('click', () => toggleChat(false));

    // Menutup dengan tombol fisik/gesture Back pada handphone
    window.addEventListener('popstate', () => {
        if (isChatOpen) {
            toggleChat(false, true);
        }
    });

    // Menutup dengan tombol Escape keyboard
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isChatOpen) {
            toggleChat(false);
        }
    });

    // Bersihkan riwayat chat
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            chatHistory = [];
            messagesBody.innerHTML = `
                <div class="chat-msg-row model">
                    <div class="chat-bubble">
                        <p>Halo! Saya <strong>CalcKu AI</strong>, asisten matematika dan kalkulus Anda. Silakan tanyakan konsep rumus turunan, integral, limit, matriks, atau panduan kalkulator ini!</p>
                    </div>
                </div>
            `;
            scrollToBottom();
        });
    }

    // Scroll ke pesan terbawah
    function scrollToBottom() {
        messagesBody.scrollTop = messagesBody.scrollHeight;
    }

    // Fungsi pembantu escape HTML
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Format teks aman & dukung format markdown serta rendering rumus LaTeX
    function formatMessageText(text) {
        if (!text) return '';

        const placeholders = [];
        function stash(content) {
            const id = `___CALCKU_TOKEN_${placeholders.length}___`;
            placeholders.push(content);
            return id;
        }

        // 1. Amankan Code Blocks (``` ... ```)
        let processed = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, function (_, lang, code) {
            const escaped = escapeHtml(code.trim());
            return stash(`<pre class="chat-code-block"><code>${escaped}</code></pre>`);
        });

        // 2. Amankan & Render Display Math: $$ ... $$ dan \[ ... \]
        processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, function (_, math) {
            const trimmed = math.trim();
            if (window.katex && window.katex.renderToString) {
                try {
                    const rendered = window.katex.renderToString(trimmed, { displayMode: true, throwOnError: false });
                    return stash(`<div class="chat-math-block">${rendered}</div>`);
                } catch (e) {
                    return stash(`<div class="chat-math-block">$$${escapeHtml(trimmed)}$$</div>`);
                }
            }
            return stash(`<div class="chat-math-block">$$${trimmed}$$</div>`);
        });

        processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, function (_, math) {
            const trimmed = math.trim();
            if (window.katex && window.katex.renderToString) {
                try {
                    const rendered = window.katex.renderToString(trimmed, { displayMode: true, throwOnError: false });
                    return stash(`<div class="chat-math-block">${rendered}</div>`);
                } catch (e) {
                    return stash(`<div class="chat-math-block">$$${escapeHtml(trimmed)}$$</div>`);
                }
            }
            return stash(`<div class="chat-math-block">$$${trimmed}$$</div>`);
        });

        // 3. Amankan & Render Inline Math: $ ... $ dan \( ... \)
        processed = processed.replace(/(^|[^\$])\$([^\$\n\r]+?)\$(?!\$)/g, function (_, prefix, math) {
            const trimmed = math.trim();
            if (!trimmed) return prefix + '$' + '$';
            if (window.katex && window.katex.renderToString) {
                try {
                    const rendered = window.katex.renderToString(trimmed, { displayMode: false, throwOnError: false });
                    return prefix + stash(`<span class="chat-math-inline">${rendered}</span>`);
                } catch (e) {
                    return prefix + stash(`<span class="chat-math-inline">$${escapeHtml(trimmed)}$</span>`);
                }
            }
            return prefix + stash(`<span class="chat-math-inline">$${trimmed}$</span>`);
        });

        processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, function (_, math) {
            const trimmed = math.trim();
            if (window.katex && window.katex.renderToString) {
                try {
                    const rendered = window.katex.renderToString(trimmed, { displayMode: false, throwOnError: false });
                    return stash(`<span class="chat-math-inline">${rendered}</span>`);
                } catch (e) {
                    return stash(`<span class="chat-math-inline">$${escapeHtml(trimmed)}$</span>`);
                }
            }
            return stash(`<span class="chat-math-inline">$${trimmed}$</span>`);
        });

        // 4. Amankan Inline Code ` ... `
        processed = processed.replace(/`([^`\n]+)`/g, function (_, code) {
            return stash(`<code>${escapeHtml(code)}</code>`);
        });

        // 5. Escape HTML teks biasa
        processed = escapeHtml(processed);

        // 6. Format Markdown (Bold, Italic, Garis Pemisah)
        processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        processed = processed.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
        processed = processed.replace(/^(?:---|\*\*\*|___)\s*$/gm, '<hr class="chat-hr">');

        // 7. Paragraf & Pemisah Baris
        const paragraphs = processed.split(/\n\s*\n/);
        let html = paragraphs.map(p => {
            const lines = p.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('<br>');
            return lines ? `<p>${lines}</p>` : '';
        }).filter(Boolean).join('');

        // 8. Kembalikan semua placeholder
        for (let i = 0; i < placeholders.length; i++) {
            html = html.split(`___CALCKU_TOKEN_${i}___`).join(placeholders[i]);
        }

        return html;
    }

    // Tambah balon pesan ke dalam jendela
    function appendMessage(role, text) {
        const row = document.createElement('div');
        row.className = `chat-msg-row ${role}`;

        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble';
        bubble.innerHTML = formatMessageText(text);

        // Tambahkan tombol Salin untuk jawaban AI
        if (role === 'model') {
            const footer = document.createElement('div');
            footer.className = 'chat-bubble-footer';

            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'chat-copy-btn';
            copyBtn.title = 'Salin pesan ini';
            copyBtn.setAttribute('aria-label', 'Salin pesan ini');
            copyBtn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span>Salin</span>
            `;

            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    copyBtn.classList.add('copied');
                    copyBtn.innerHTML = `
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <span>Tersalin!</span>
                    `;
                    setTimeout(() => {
                        copyBtn.classList.remove('copied');
                        copyBtn.innerHTML = `
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                            <span>Salin</span>
                        `;
                    }, 1800);
                } catch (err) {
                    console.warn('Gagal menyalin pesan:', err);
                }
            });

            footer.appendChild(copyBtn);
            bubble.appendChild(footer);
        }

        row.appendChild(bubble);
        messagesBody.appendChild(row);
        scrollToBottom();

        // Render KaTeX auto-render jika tersedia di halaman (sebagai pengaman tambahan)
        if (window.renderMathInElement) {
            try {
                window.renderMathInElement(bubble, {
                    delimiters: [
                        { left: '$$', right: '$$', display: true },
                        { left: '$', right: '$', display: false },
                        { left: '\\[', right: '\\]', display: true },
                        { left: '\\(', right: '\\)', display: false }
                    ],
                    throwOnError: false,
                    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
                });
            } catch (e) {
                // Ignore KaTeX parsing errors
            }
        }
    }

    // Indikator sedang mengetik
    function showTypingIndicator() {
        const id = 'chat-typing-indicator';
        if (document.getElementById(id)) return;

        const row = document.createElement('div');
        row.id = id;
        row.className = 'chat-msg-row model';

        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble';
        bubble.innerHTML = `
            <div class="chat-typing-dots">
                <span class="chat-typing-dot"></span>
                <span class="chat-typing-dot"></span>
                <span class="chat-typing-dot"></span>
            </div>
        `;
        row.appendChild(bubble);
        messagesBody.appendChild(row);
        scrollToBottom();
    }

    function removeTypingIndicator() {
        const indicator = document.getElementById('chat-typing-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    // Kirim pesan
    async function sendMessage(textToSend) {
        const text = (textToSend || chatInput.value || '').trim();
        if (!text || isLoading) return;

        chatInput.value = '';
        chatInput.style.height = 'auto';
        isLoading = true;
        sendBtn.disabled = true;

        // Tampilkan pesan user
        appendMessage('user', text);
        showTypingIndicator();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    pesan: text,
                    history: chatHistory
                })
            });

            removeTypingIndicator();

            const data = await response.json();
            if (response.ok && data.sukses) {
                const botReply = data.balasan || 'Maaf, tidak ada tanggapan yang diterima.';
                appendMessage('model', botReply);

                // Perbarui riwayat percakapan lokal
                chatHistory.push({ role: 'user', text: text });
                chatHistory.push({ role: 'model', text: botReply });
                if (chatHistory.length > 10) {
                    chatHistory = chatHistory.slice(-10);
                }
            } else {
                const errMsg = data.error || 'Terjadi gangguan saat memproses jawaban.';
                appendMessage('model', `⚠️ ${errMsg}`);
            }
        } catch (err) {
            removeTypingIndicator();
            appendMessage('model', '⚠️ Gagal terhubung ke server. Pastikan koneksi internet atau server lokal aktif.');
        } finally {
            isLoading = false;
            sendBtn.disabled = false;
            if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
                chatInput.focus();
            }
        }
    }

    // Event listener kirim
    sendBtn.addEventListener('click', () => sendMessage());

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-expand textarea
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 80) + 'px';
    });

    // Suggestion chips
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const promptText = chip.getAttribute('data-prompt') || chip.innerText.trim();
            if (!isChatOpen) toggleChat(true);
            sendMessage(promptText);
        });
    });

})();
