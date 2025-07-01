document.addEventListener('DOMContentLoaded', function() {
    const datetimeDisplay = document.getElementById('current-datetime');
    const runningTextElement = document.getElementById('running-text');
    const footerTextElement = document.getElementById('footer-text');
    const categoryContentMap = {
        "ทีวีดิจิตอล": document.getElementById('content-thai-tv'),
        "กีฬา": document.getElementById('content-sport'),
        "หนังทีวี": document.getElementById('content-movies'),
        "สารคดี": document.getElementById('content-documentary'),
        "IPTV": document.getElementById('content-iptv')
    };
    let channelsData = null;
    let textsData = null;

    const redAccentColor = getComputedStyle(document.documentElement).getPropertyValue('--red-accent').trim();

    /**
     * แสดงสถานะการโหลดสำหรับ container ที่กำหนด
     * @param {HTMLElement} container - องค์ประกอบ container ที่จะแสดงสถานะการโหลด
     */
    function showLoading(container) {
        container.querySelector('.loading-indicator').classList.add('active');
        container.querySelector('.no-channels-message').classList.remove('active');
        // ลบ channel links เก่าออกก่อนเสมอเมื่อจะโหลดใหม่
        const existingChannelLinks = container.querySelectorAll('.channel-link');
        existingChannelLinks.forEach(link => link.remove());
    }

    /**
     * ซ่อนสถานะการโหลดสำหรับ container ที่กำหนด
     * @param {HTMLElement} container - องค์ประกอบ container ที่จะซ่อนสถานะการโหลด
     */
    function hideLoading(container) {
        container.querySelector('.loading-indicator').classList.remove('active');
    }

    /**
     * แสดงข้อความ "ไม่พบช่อง" สำหรับ container ที่กำหนด
     * @param {HTMLElement} container - องค์ประกอบ container ที่จะแสดงข้อความ
     */
    function showNoChannelsMessage(container) {
        hideLoading(container);
        container.querySelector('.no-channels-message').classList.add('active');
    }

    /**
     * ล้างข้อความสถานะทั้งหมด (โหลดและไม่พบช่อง) สำหรับ container ที่กำหนด
     * @param {HTMLElement} container - องค์ประกอบ container ที่จะล้างข้อความ
     */
    function clearMessages(container) {
        container.querySelector('.loading-indicator').classList.remove('active');
        container.querySelector('.no-channels-message').classList.remove('active');
    }

    /**
     * โหลดข้อมูลจากไฟล์ JSON ที่ระบุ
     * @param {string} fileName - ชื่อไฟล์ JSON ที่จะโหลด (เช่น 'channels.json')
     * @returns {Promise<Array|Object>} - ข้อมูลที่โหลดมา
     * @throws {Error} - หากการโหลดหรือการแยกวิเคราะห์ข้อมูลล้มเหลว
     */
    async function fetchData(fileName) {
        try {
            const response = await fetch(fileName);
            if (!response.ok) {
                const errorText = response.status === 404
                    ? `${fileName} not found (HTTP 404). Please ensure the file exists at the root of your server.`
                    : `Failed to load ${fileName}: HTTP error! status: ${response.status}`;
                throw new Error(errorText);
            }
            const data = await response.json();
            return data;
        } catch (error) {
            console.error(`Error loading or parsing ${fileName}:`, error);
            throw error; // ส่งต่อข้อผิดพลาดเพื่อให้ Promise.all จัดการ
        }
    }

    /**
     * โหลดข้อมูลช่องจาก channels.json
     * @returns {Promise<void>}
     */
    async function loadChannelsData() {
        if (channelsData) return;
        try {
            const data = await fetchData('channels.json');
            if (!Array.isArray(data)) {
                throw new Error('Fetched data from channels.json is not an array. Please ensure the JSON is an array of channel objects.');
            }
            channelsData = data;
        } catch (error) {
            console.error('Final error handling for channels.json:', error);
            // แสดงข้อความข้อผิดพลาดในทุกหมวดหมู่
            Object.values(categoryContentMap).forEach(container => {
                container.innerHTML = `<div class="no-channels-message active" style="color: ${redAccentColor}; text-align: center; padding: 20px;">
                                           เกิดข้อผิดพลาดในการโหลดช่อง: ${error.message}<br>โปรดลองใหม่อีกครั้งในภายหลัง
                                       </div>`;
            });
            channelsData = []; // กำหนดให้เป็น array ว่างเพื่อหลีกเลี่ยงการประมวลผลซ้ำ
        }
    }

    /**
     * โหลดข้อมูลข้อความจาก texts.json
     * @returns {Promise<void>}
     */
    async function loadTextsData() {
        if (textsData) return;
        try {
            const data = await fetchData('texts.json');
            if (typeof data !== 'object' || data === null) {
                throw new Error('Fetched data from texts.json is not a valid object.');
            }
            textsData = data;
            if (runningTextElement && textsData.runningText) {
                // เพิ่มช่องว่างเพิ่มเติมด้านท้ายข้อความที่วิ่ง เพื่อให้มีช่องว่างระหว่างรอบ
                // การทำซ้ำข้อความพร้อมช่องว่างเยอะๆ จะช่วยให้ marquee ดูต่อเนื่องและมีระยะห่างที่ปลาย
                const originalText = textsData.runningText;
                const separator = "                                    "; // เพิ่มช่องว่างเยอะๆ
                runningTextElement.textContent = originalText + separator + originalText + separator + originalText; // ทำซ้ำ 3 รอบ
            }
            if (footerTextElement && textsData.footerText) {
                footerTextElement.textContent = textsData.footerText;
            }
        } catch (error) {
            console.error('Final error handling for texts.json:', error);
            textsData = {}; // กำหนดเป็น object ว่างเมื่อเกิดข้อผิดพลาด
            if (runningTextElement) runningTextElement.textContent = "เกิดข้อผิดพลาดในการโหลดข้อความประกาศ!";
            if (footerTextElement) footerTextElement.textContent = "เกิดข้อผิดพลาดในการโหลดข้อความท้ายหน้า!";
        }
    }

    // โหลดข้อมูลเริ่มต้นทั้งหมดพร้อมกัน
    Promise.all([loadChannelsData(), loadTextsData()])
        .then(() => {
            console.log('All initial data (channels and texts) loaded successfully!');
        })
        .catch(error => {
            console.error('An error occurred during initial data loading. Some parts of the page might not load correctly:', error);
        });

    // Event listener สำหรับการคลิกช่อง (Channel Link)
    document.querySelector('main.categories-container').addEventListener('click', function(event) {
        const link = event.target.closest('.channel-link');
        if (link) {
            event.preventDefault();
            const url = link.dataset.url;
            const imgElement = link.querySelector('img');
            const channelName = imgElement ? imgElement.alt : 'Unknown Channel';
            const categoryElement = link.closest('.category');
            const categoryButton = categoryElement ? categoryElement.querySelector('.accordion-button') : null;
            // ลบ emoji และ trim ช่องว่าง
            const categoryName = categoryButton ? categoryButton.innerText.replace(/[\u{1F000}-\u{1FFFF}\u{2000}-\u{2BFF}]/gu, '').replace(/\s+/g, ' ').trim() : 'Unknown Category';
            
            if (typeof gtag === 'function') {
                gtag('event', 'channel_click', { 'channel_name': channelName, 'category': categoryName, 'link_url': url });
            }
            // หน่วงเวลาเล็กน้อยก่อนเปลี่ยนหน้า เพื่อให้ Google Analytics ส่งข้อมูลทัน
            setTimeout(() => { if (url) window.location.href = url; }, 200);
        }
    });

    /**
     * จัดรูปแบบวันที่และเวลา
     * @param {Date} date - วัตถุ Date ที่จะจัดรูปแบบ
     * @returns {{display: string, iso: string}} วัตถุที่มีสตริงที่จัดรูปแบบและสตริง ISO
     */
    function formatDateTime(date) {
        const optionsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const optionsTime = { hour: '2-digit', minute: '2-digit', hour12: false };
        const datePart = date.toLocaleDateString('th-TH', optionsDate);
        const timePart = date.toLocaleTimeString('th-TH', optionsTime);
        return { display: `${datePart} ${timePart}`, iso: date.toISOString() };
    }

    /**
     * อัปเดตการแสดงผลวันที่และเวลาปัจจุบัน
     */
    function updateDateTime() {
        const now = new Date();
        const formatted = formatDateTime(now);
        datetimeDisplay.textContent = formatted.display;
        datetimeDisplay.setAttribute('datetime', formatted.iso);
    }
    updateDateTime(); // เรียกใช้ครั้งแรกทันที
    setInterval(updateDateTime, 1000); // อัปเดตทุกวินาที

    // จัดการ transitionend เพื่อซ่อน content อย่างสมบูรณ์เมื่อปิด
    document.querySelectorAll('.accordion-content').forEach(contentElement => {
        contentElement.addEventListener('transitionend', function() {
            if (!this.classList.contains('show')) {
                const computedMaxHeight = window.getComputedStyle(this).maxHeight;
                if (computedMaxHeight === '0px') {
                    this.style.display = 'none'; // ซ่อนอย่างสมบูรณ์เมื่อปิดและ transition จบ
                }
            }
        });
    });

    /**
     * ปิด Accordion ที่กำหนด
     * @param {HTMLElement} contentElement - องค์ประกอบ content ของ Accordion
     * @param {HTMLElement} buttonElement - องค์ประกอบ button ของ Accordion
     */
    function closeAccordion(contentElement, buttonElement) {
        contentElement.classList.remove('show');
        contentElement.style.maxHeight = '0px';
        buttonElement.setAttribute('aria-expanded', 'false');
    }

    /**
     * เปิด Accordion ที่กำหนดและโหลดช่องที่เกี่ยวข้อง
     * @param {HTMLElement} contentElement - องค์ประกอบ content ของ Accordion
     * @param {HTMLElement} buttonElement - องค์ประกอบ button ของ Accordion
     */
    async function openAccordion(contentElement, buttonElement) {
        // ต้องตั้งค่า display: flex ก่อน เพื่อให้ scrollHeight คำนวณได้ถูกต้อง
        contentElement.style.display = 'flex'; 
        buttonElement.setAttribute('aria-expanded', 'true');

        showLoading(contentElement); // แสดง loading และลบ channel links เก่า

        if (!channelsData) {
            await loadChannelsData(); // โหลดข้อมูลหากยังไม่ได้โหลด
        }

        // หากยังคงมีข้อผิดพลาดหลังจากพยายามโหลด ให้หยุดทำงาน
        if (!channelsData || channelsData.length === 0) {
            hideLoading(contentElement);
            // ข้อความ error จะถูกแสดงไปแล้วใน loadChannelsData หากเกิดข้อผิดพลาด
            return; 
        }

        clearMessages(contentElement); // ล้างข้อความสถานะหลังจากโหลดข้อมูลสำเร็จ (หรือจัดการข้อผิดพลาดไปแล้ว)

        // ลบ emoji และ trim ช่องว่างสำหรับชื่อหมวดหมู่
        const categoryText = buttonElement.innerText.replace(/[\u{1F000}-\u{1FFFF}\u{2000}-\u{2BFF}]/gu, '').replace(/\s+/g, ' ').trim();
        const filteredChannels = channelsData.filter(channel => channel.category === categoryText);

        if (filteredChannels.length === 0) {
            showNoChannelsMessage(contentElement);
        } else {
            filteredChannels.forEach(channel => {
                const link = document.createElement('a');
                link.href = "#";
                link.classList.add('channel-link');
                link.dataset.url = channel.data_url;
                link.setAttribute('aria-label', channel.aria_label);

                const img = document.createElement('img');
                img.src = channel.img_src;
                img.alt = channel.name;
                img.loading = "lazy";
                link.appendChild(img);
                contentElement.appendChild(link);
            });
        }

        // ใช้ requestAnimationFrame เพื่อให้แน่ใจว่า DOM ได้รับการอัปเดตก่อนคำนวณความสูง
        requestAnimationFrame(() => {
            const actualContentHeight = contentElement.scrollHeight;
            contentElement.style.maxHeight = (actualContentHeight + 16) + 'px'; // +16px เพื่อรองรับ padding/margin
            contentElement.classList.add('show');
        });
        hideLoading(contentElement); // ซ่อน loading เมื่อช่องถูกแสดง
    }

    // จัดการการคลิกปุ่ม Accordion ทั้งหมด
    const allAccordionButtons = document.querySelectorAll('.accordion-button');
    allAccordionButtons.forEach(button => {
        const content = button.nextElementSibling;
        button.addEventListener('click', function() {
            // ปิด Accordion อื่นๆ ที่เปิดอยู่
            allAccordionButtons.forEach(otherButton => {
                const otherContent = otherButton.nextElementSibling;
                if (otherButton !== this && otherContent && otherContent.classList.contains('show')) {
                    closeAccordion(otherContent, otherButton);
                }
            });
            // สลับสถานะ Accordion ที่ถูกคลิก
            if (content && content.classList.contains('show')) {
                closeAccordion(content, this);
            } else if (content) {
                openAccordion(content, this);
            }
        });
    });

    // --- ส่วนป้องกันการดูโค้ด (Code View Protection) ที่ถูกลบออกแล้ว ---
    // (ตามคำแนะนำเพื่อปรับปรุงประสบการณ์ผู้ใช้)
    // หากต้องการเพิ่มมาตรการความปลอดภัย ควรพิจารณาในฝั่ง Backend แทน Frontend
});
