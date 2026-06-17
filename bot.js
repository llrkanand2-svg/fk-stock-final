const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio'); 
const express = require('express');
const fs = require('fs');
const path = require('path');

// --- 🔒 CONFIGURATION HARDLOCKED ---
const BOT_TOKEN = '8901855590:AAHFlMQ_LNzOrJ0noP8BPQgnkSAZ2mRo2uc'; 
const ADMIN_CHAT_ID = '7485181331'; 
const CHECK_INTERVAL = 15000; // STRICT 15 SECONDS
const RENDER_URL = 'https://fk-stock-final.onrender.com'; 
const DB_FILE = path.join(__dirname, 'database.json');
// ----------------------------------------

const bot = new Telegraf(BOT_TOKEN);
const activeUsers = {};
const userSessions = {}; 

let approvedUsersCache = [];

function initDatabase() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            const initialData = [ADMIN_CHAT_ID.toString()];
            fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
            approvedUsersCache = initialData;
            return;
        }
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        if (!fileContent.trim()) {
            approvedUsersCache = [ADMIN_CHAT_ID.toString()];
            return;
        }
        const users = JSON.parse(fileContent);
        if (!Array.isArray(users)) {
            approvedUsersCache = [ADMIN_CHAT_ID.toString()];
            return;
        }
        if (!users.includes(ADMIN_CHAT_ID.toString())) {
            users.push(ADMIN_CHAT_ID.toString());
        }
        approvedUsersCache = users.map(String);
    } catch (e) {
        approvedUsersCache = [ADMIN_CHAT_ID.toString()];
    }
}

initDatabase();

function saveApprovedUsers(usersList) {
    try {
        const uniqueUsers = [...new Set(usersList.map(String))];
        if (!uniqueUsers.includes(ADMIN_CHAT_ID.toString())) {
            uniqueUsers.push(ADMIN_CHAT_ID.toString());
        }
        approvedUsersCache = uniqueUsers; 
        fs.writeFileSync(DB_FILE, JSON.stringify(uniqueUsers, null, 2));
    } catch (e) {}
}

function isUserApproved(userId) {
    if (!userId) return false;
    return approvedUsersCache.includes(userId.toString());
}

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(bot.webhookCallback('/secret-telegram-webhook'));

app.get('/', (req, res) => res.status(200).send('Stock Engine Core Online!'));

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Stock Server listening on port ${PORT}`);
    try {
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        await bot.telegram.setWebhook(`${RENDER_URL}/secret-telegram-webhook`, {
            drop_pending_updates: true 
        });
        console.log("🎯 Webhook strictly configured.");
    } catch (err) {
        console.log("⚠️ Webhook setup warning: ", err.message);
    }
});

setInterval(() => {
    axios.get(RENDER_URL).catch(() => {}); 
}, 15000); 

const getProKeyboard = () => {
    return Markup.keyboard([
        ['🚨 Start Stock Track'],
        ['📋 List Active', '🛑 Stop All Operations']
    ]).resize();
};

bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const clickerId = ctx.from.id.toString();
    
    if (data.startsWith('approve_')) {
        if (clickerId !== ADMIN_CHAT_ID.toString()) return ctx.answerCbQuery("Unauthorized! ❌").catch(() => {});
        const targetUserId = data.split('_')[1].trim();
        
        initDatabase();
        if (!approvedUsersCache.includes(targetUserId)) {
            approvedUsersCache.push(targetUserId);
            saveApprovedUsers(approvedUsersCache);
        }
        
        await ctx.answerCbQuery("User Approved! ✅").catch(() => {});
        await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n✅ **Status: Approved!**`).catch(() => {});
        bot.telegram.sendMessage(targetUserId, "🥳 **Aapka access approve ho gaya hai!**\nCommands use karne ke liye ek baar `/start` dabayein.").catch(() => {});
        return;
    }

    if (data.startsWith('decline_')) {
        if (clickerId !== ADMIN_CHAT_ID.toString()) return ctx.answerCbQuery("Unauthorized! ❌").catch(() => {});
        await ctx.answerCbQuery("User Declined! ❌").catch(() => {});
        await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n❌ **Status: Declined!**`).catch(() => {});
        return;
    }
});

bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    const name = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || 'No Name';
    
    initDatabase();
    if (isUserApproved(userId)) {
        delete userSessions[userId]; 
        return ctx.reply(`🤖 *Welcome to Flipkart Stock Checker Pro!* Ready to sniff targets!`, getProKeyboard());
    }
    
    ctx.reply(`🔒 **Access Denied!**\n\nAap abhi approved nahi hain.\nAapki Telegram ID: \`${userId}\`\n\nAdmin ko automatic request bhej di gayi hai.`);
    
    bot.telegram.sendMessage(ADMIN_CHAT_ID, 
        `🚨 **New Stock Bot Request!**\n\n👤 Name: ${name}\n🆔 ID: \`${userId}\`\n\n👉 Action lein:`,
        Markup.inlineKeyboard([[
            Markup.button.callback('Approve ✅', `approve_${userId}`), 
            Markup.button.callback('Decline ❌', `decline_${userId}`)
        ]])
    ).catch(() => {});
});

bot.hears('🚨 Start Stock Track', (ctx) => {
    const userId = ctx.from.id.toString();
    if (!isUserApproved(userId)) return;
    userSessions[userId] = 'stock'; 
    ctx.reply("🕵️‍♂️ **Agent Stock Radar Ready!**\n\nOut of stock wale product ka link bhejo bhai!");
});

bot.hears('📋 List Active', (ctx) => { displayActiveTracks(ctx); });
bot.hears('🛑 Stop All Operations', (ctx) => { killAllOperations(ctx); });

bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id.toString();
    if (!isUserApproved(userId)) return;

    const textInput = ctx.message.text.trim().toLowerCase();

    if (textInput.startsWith('/stop') && textInput !== '/stop_all') {
        const chatId = ctx.chat.id.toString();
        const numStr = textInput.replace('/stop', '').trim();
        const index = parseInt(numStr) - 1;

        if (isNaN(index) || !activeUsers[chatId] || !activeUsers[chatId][index]) {
            return ctx.reply("⚠️ **Galat Target Number!** Pehle `📋 List Active` check karo boss.");
        }

        const removedItem = activeUsers[chatId][index];
        clearInterval(removedItem.interval);
        activeUsers[chatId].splice(index, 1);

        return ctx.reply(`🛑 <b>Target [${index + 1}] radar se permanent saaf!</b>\nTracking successfully stopped for:\n<code>${removedItem.url}</code>`, { parse_mode: 'HTML', disable_web_page_preview: true });
    }

    if (['🚨 start stock track', '📋 list active', '🛑 stop all operations'].includes(textInput)) return;

    if (userSessions[userId] === 'stock') {
        const args = ctx.message.text.replace(/\n/g, ' ').split(' ').filter(arg => arg.trim() !== '');
        let fkLink = args.find(arg => arg.includes('flipkart.com') || arg.includes('fkrt.it'));

        if (!fkLink) return ctx.reply(`❌ Valid Flipkart link bhejo bhai!`, getProKeyboard());
        setupStockScraperSystem(ctx, fkLink);
        delete userSessions[userId]; 
    }
});

function setupStockScraperSystem(ctx, fkLink) {
    const chatId = ctx.chat.id.toString();
    let pid = Buffer.from(fkLink).toString('base64').substring(0, 10);

    if (!activeUsers[chatId]) activeUsers[chatId] = [];
    const intervalId = setInterval(() => { checkProductStockStatus(ctx, chatId, pid, fkLink); }, CHECK_INTERVAL);

    activeUsers[chatId].push({
        id: pid, url: fkLink, mode: 'Stock Checker', interval: intervalId
    });

    ctx.reply(`🕵️‍♂️ **Undercover Agent Radar Par Lock!**\n\nAnti-Block Mobile Engine configured. 15 second mein strict check chalu!`);
    checkProductStockStatus(ctx, chatId, pid, fkLink);
}

function displayActiveTracks(ctx) {
    const chatId = ctx.chat.id.toString();
    if (!activeUsers[chatId] || activeUsers[chatId].length === 0) return ctx.reply("😴 Koyi active target stock radar par nahi hai.");
    
    let msg = "📋 <b>Radar Par Active Stock Targets Matrix:</b>\n\n";
    activeUsers[chatId].forEach((item, index) => {
        msg += `🔢 <b>Target [${index + 1}]</b>\n⚙️ <b>Mode:</b> <code>[${item.mode}]</code>\n🔗 <b>Link:</b> ${item.url}\n🛑 <b>Stop Command:</b> /stop${index + 1}\n\n`;
    });
    
    ctx.reply(msg, { parse_mode: 'HTML', disable_web_page_preview: true });
}

function killAllOperations(ctx) {
    const chatId = ctx.chat.id.toString();
    if (activeUsers[chatId] && activeUsers[chatId].length > 0) {
        activeUsers[chatId].forEach(item => clearInterval(item.interval));
        delete activeUsers[chatId];
        ctx.reply("🛑 Saari stock tracking band kar di gayi.");
    } else { ctx.reply("⚠️ Koyi active operation chal hi nahi rahi."); }
}

// --- 🔬 ANTI-BLOCK PINCODE SNIFFER ENGINE ---
async function checkProductStockStatus(ctx, chatId, pid, originalUrl) {
    if (!activeUsers[chatId]) return;
    
    // 🔥 LIVE RE-CALCULATE SERIAL NUMBER MATRIX EVERY HIT
    const itemIndex = activeUsers[chatId].findIndex(item => item.id === pid);
    if (itemIndex === -1) return;

    try {
        const response = await axios.get(originalUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Cookie': 'pincode=125121; sn=125121; amsn=125121;'
            },
            timeout: 12000 
        });
        
        const htmlLower = response.data.toString().toLowerCase();
        
        const hasBuyNowButton = htmlLower.includes('buy now') || 
                                htmlLower.includes('add to cart') || 
                                htmlLower.includes('go to cart');
                                
        const isOutOfStockText = htmlLower.includes('currently unavailable') || 
                                htmlLower.includes('this item is currently out of stock');

        if (hasBuyNowButton && !isOutOfStockText) {
            // 🔥 Strict Dynamic Serial Number mapping
            const serialNumber = itemIndex + 1;

            await bot.telegram.sendMessage(chatId, 
                `🚨 **STOCK AAGYA HAII LGA JAKE FASTTT POORA LOOT LO** 🚨\n\n🔥 Bhai Flipkart pr stock wapas aa gaya hai, turant click karo aur order maro! 🔥\n\n🔗 Link:\n${originalUrl}\n\n🛑 Stop Tracking: /stop${serialNumber}`,
                { parse_mode: 'HTML' }
            ).catch(() => {});
        }
    } catch (err) {}
}
