const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');

require('dotenv').config();

const URL_BASE = 'https://www.shohoz.com/booking/bus/search?';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Define your journeys to check
const journeysToCheck = [
    {
        id: 1,
        fromcity: "Bogura",
        tocity: "Dhaka",
        doj: "22-Jun-2024",
        chatId: 6913644510,
        acType: "ANY"
    }
];

const FILENAME_BASE = 'bus_list_'; // Base filename for saving bus lists
const JSON_EXTENSION = '.json'; // File extension for JSON files

async function getBusList(journeyId) {
    const journey = journeysToCheck.find(j => j.id === journeyId);
    if (!journey) {
        console.error(`Journey with ID ${journeyId} not found.`);
        return [];
    }

    const URL = `${URL_BASE}fromcity=${journey.fromcity}&tocity=${journey.tocity}&doj=${journey.doj}&dor=`;
    console.log(`Launching headless browser for journey ${journeyId}...`, URL);

    let browser;
    try {
        browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.goto(URL, {
            waitUntil: 'networkidle0',
            timeout: 60000 
        });

        console.log(`Waiting for bus data for journey ${journeyId} to load...`);
        await page.waitForSelector('.trip-row', { timeout: 60000 });

        const busList = await page.evaluate((acType, journeyId) => {
            const buses = [];
            document.querySelectorAll('.trip-row').forEach(bus => {
                const tripData = JSON.parse(bus.getAttribute('data-trip'));
                const seatAvailability = +bus.querySelector('td[data-title="Seats Available"]').textContent.trim();
                if (acType === 'ANY' || (acType === 'Non AC' && tripData.tripRoute.bus_desc.includes('Non AC')) || (acType === 'AC' && tripData.tripRoute.bus_desc.includes('AC'))) {
                    buses.push({
                        journeyId: journeyId,
                        busId: tripData.tripId, // Using tripId as busId
                        company: tripData.details.company_name,
                        busType: tripData.tripRoute.bus_desc.includes('Non AC') ? 'Non AC' : 'AC',
                        route: tripData.details.trip_heading,
                        startTime: tripData.details.departure_time,
                        endTime: tripData.details.arrival_time,
                        seatsAvailable: seatAvailability
                    });
                }
            });
            return buses;
        }, journey.acType, journey.id);

        console.log(`Fetched ${busList.length} buses for journey ${journeyId}.`);
        return busList;
    } catch (error) {
        console.error(`Error fetching bus list for journey ${journeyId}:`, error);
        return [];
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

function convertToAMPM(time) {
    const [hours, minutes] = time.split(':');
    let period = 'AM';
    let hours12 = parseInt(hours);
    if (hours12 >= 12) {
        period = 'PM';
        if (hours12 > 12) {
            hours12 -= 12;
        }
    }
    return `${hours12}:${minutes} ${period}`;
}

async function sendTelegramNotification(newBuses, journeyId) {
    console.log(`Sending Telegram notification for journey ${journeyId}...`);

    const journey = journeysToCheck.find(j => j.id === journeyId);
    if (!journey) {
        console.error(`Journey with ID ${journeyId} not found.`);
        return;
    }

    let message = `New Buses Added: \n\nFrom: ${journey.fromcity}, To: ${journey.tocity}, \nDate: ${journey.doj}, AC: ${journey.acType}\n\n`;

    newBuses.forEach((bus, index) => {
        message += `${index + 1}. **${bus.company}**\n`;
        message += `   - Type: ${bus.busType}\n`;
        message += `   - Time: ${convertToAMPM(bus.startTime)} - ${convertToAMPM(bus.endTime)}\n`;
        message += `   - Seats Available: ${bus.seatsAvailable}\n\n`;
    });

    const bookTicketUrl = `${URL_BASE}fromcity=${journey.fromcity}&tocity=${journey.tocity}&doj=${journey.doj}&dor=`;

    message += `Book your ticket now: [Link to Book Tickets](${bookTicketUrl})`;

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    try {
        const result = await axios.post(url, {
            chat_id: journey.chatId,
            text: message,
            parse_mode: 'Markdown'
        });
        console.log(`Telegram notification sent successfully for journey ${journeyId}.`);
        console.log('Telegram response:', result.data);
    } catch (error) {
        console.error(`Error sending Telegram notification for journey ${journeyId}:`, error);
    }
}

async function checkForNewBuses(journeyId) {
    console.log(`Checking for new buses for journey ${journeyId}...`);
    try {
        const currentBusList = await getBusList(journeyId);
        const savedBusList = loadBusList(journeyId);
        const newBuses = currentBusList.filter(bus => !savedBusList.find(savedBus => savedBus.busId === bus.busId));

        if (newBuses.length > 0) {
            console.log(`${newBuses.length} new buses found for journey ${journeyId}.`);
            await sendTelegramNotification(newBuses, journeyId);
            saveBusList(currentBusList, journeyId);
        } else {
            console.log(`No new buses found for journey ${journeyId}.`);
        }
    } catch (error) {
        console.error(`Error checking for new buses for journey ${journeyId}:`, error);
    }
}

function saveBusList(busList, journeyId) {
    const filename = `${FILENAME_BASE}${journeyId}${JSON_EXTENSION}`;
    try {
        fs.writeFileSync(filename, JSON.stringify(busList, null, 2));
        console.log(`Bus list saved for journey ${journeyId}.`);
    } catch (error) {
        console.error(`Error saving bus list for journey ${journeyId}:`, error);
    }
}

function loadBusList(journeyId) {
    const filename = `${FILENAME_BASE}${journeyId}${JSON_EXTENSION}`;
    try {
        if (fs.existsSync(filename)) {
            const data = JSON.parse(fs.readFileSync(filename));
            console.log(`Bus list loaded for journey ${journeyId}.`);
            return data;
        }
        console.log(`No saved bus list found for journey ${journeyId}.`);
    } catch (error) {
        console.error(`Error loading bus list for journey ${journeyId}:`, error);
    }
    return [];
}

// Schedule to run for each journey
journeysToCheck.forEach(journey => {
    cron.schedule('*/10 * * * *', () => { // Run every 10 minutes
        checkForNewBuses(journey.id);
        console.log("=====================================");
    });
});

// Initial run for each journey
journeysToCheck.forEach(journey => {
    (async () => {
        await checkForNewBuses(journey.id);
        console.log("=====================================");
    })();
});
