const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');

require('dotenv').config(); 

const URL = 'https://www.shohoz.com/booking/bus/search?fromcity=Bogura&tocity=Dhaka&doj=22-Jun-2024&dor=';
const FILENAME = 'bus_list.json';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // Replace with your chat ID

async function getBusList() {
    console.log('Launching headless browser...');
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'networkidle0' });

    console.log('Waiting for bus data to load...');
    await page.waitForSelector('.trip-row');

    const busList = await page.evaluate(() => {
        const buses = [];
        document.querySelectorAll('.trip-row').forEach(bus => {
            const tripData = JSON.parse(bus.getAttribute('data-trip'));
            const seatAvailability = bus.querySelector('td[data-title="Seats Available"]').textContent.trim();
            if (tripData.tripRoute.bus_desc.includes('Non AC')) {
                buses.push({
                    company: tripData.details.company_name,
                    busType: tripData.tripRoute.bus_desc,
                    route: tripData.details.trip_heading,
                    startTime: tripData.details.departure_time,
                    endTime: tripData.details.arrival_time,
                    fare: tripData.details.economy_class_fare,
                    seatsAvailable: seatAvailability
                });
            }
        });
        return buses;
    });

    await browser.close();
    console.log(`Fetched ${busList.length} buses.`);
    return busList;
}


async function sendTelegramNotification(newBuses) {
    console.log('Sending Telegram notification...');
    let message = '';
    newBuses.forEach(bus => {
        message += `${bus.company}\n${bus.busType}\nRoute: ${bus.route}\nStarting Time: ${bus.startTime}\nEnding Time: ${bus.endTime}\nFare: ${bus.fare}\nSeats Available: ${bus.seatsAvailable}\n\n`;
    });

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    try {
        const result = await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: `New Buses Added:\n${message}\nBook your ticket now: ${URL}`
        });
        console.log('Telegram notification sent successfully.');
        console.log('Telegram response:', result.data);
    } catch (error) {
        console.error('Error sending Telegram notification:', error);
    }
}



async function checkForNewBuses() {
    console.log('Checking for new buses...');
    const currentBusList = await getBusList();
    const savedBusList = loadBusList();
    const newBuses = currentBusList.filter(bus => !savedBusList.some(savedBus => savedBus.company === bus.company && savedBus.route === bus.route));

    if (newBuses.length > 0) {
        console.log(`${newBuses.length} new buses found.`);
        await sendTelegramNotification(newBuses);
        saveBusList(currentBusList);
    } else {
        console.log('No new buses found.');
    }
}

function saveBusList(busList) {
    fs.writeFileSync(FILENAME, JSON.stringify(busList, null, 2));
    console.log('Bus list saved.');
}

function loadBusList() {
    if (fs.existsSync(FILENAME)) {
        const data = JSON.parse(fs.readFileSync(FILENAME));
        console.log('Bus list loaded.');
        return data;
    }
    console.log('No saved bus list found.');
    return [];
}

cron.schedule('0 * * * *', checkForNewBuses);  // Schedule to run every hour

(async () => {
    await checkForNewBuses();  // Initial run
})();
