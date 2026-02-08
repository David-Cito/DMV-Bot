"use strict";
// Notification Service for Queue System V2
// See openspec/specs/notifications/spec.md
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePhoneNumber = normalizePhoneNumber;
exports.isValidPhoneNumber = isValidPhoneNumber;
exports.sendSms = sendSms;
exports.getWelcomeMessage = getWelcomeMessage;
exports.getTierSelectionMessage = getTierSelectionMessage;
exports.getWaitlistConfirmedMessage = getWaitlistConfirmedMessage;
exports.getInviteMessage = getInviteMessage;
exports.getDepositConfirmedMessage = getDepositConfirmedMessage;
exports.getQueueEntryMessage = getQueueEntryMessage;
exports.getBookedMessage = getBookedMessage;
exports.getBookingConfirmedMessage = getBookingConfirmedMessage;
exports.getPaymentFailedMessage = getPaymentFailedMessage;
exports.getCardUpdatedMessage = getCardUpdatedMessage;
exports.getCancelConfirmedMessage = getCancelConfirmedMessage;
exports.getInviteExpiredMessage = getInviteExpiredMessage;
exports.getStatusMessage = getStatusMessage;
exports.getHelpMessage = getHelpMessage;
exports.getBookingSubmitFailedMessage = getBookingSubmitFailedMessage;
exports.sendInviteMessage = sendInviteMessage;
exports.sendBookedMessage = sendBookedMessage;
exports.sendPaymentFailedMessage = sendPaymentFailedMessage;
exports.sendBookingSubmitFailedMessage = sendBookingSubmitFailedMessage;
const supabase_client_1 = require("../db/supabase_client");
const config_service_1 = require("./config_service");
// ============================================================================
// TWILIO CLIENT
// ============================================================================
let twilioClient = null;
async function getTwilio() {
    if (!twilioClient) {
        const twilio = (await Promise.resolve().then(() => __importStar(require('twilio')))).default;
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (!accountSid || !authToken) {
            throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables are required');
        }
        twilioClient = twilio(accountSid, authToken);
    }
    return twilioClient;
}
function getTwilioFromNumber() {
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!fromNumber) {
        throw new Error('TWILIO_PHONE_NUMBER environment variable is required');
    }
    return fromNumber;
}
// ============================================================================
// PHONE VALIDATION
// ============================================================================
// US phone number patterns
const PHONE_E164_REGEX = /^\+1\d{10}$/; // +18083426751
const PHONE_10_DIGIT_REGEX = /^\d{10}$/; // 8083426751
const PHONE_FORMATTED_REGEX = /^\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})$/; // (808)342-6751, 808-342-6751
/**
 * Validate and normalize a US phone number to E.164 format (+1XXXXXXXXXX)
 * Returns null if invalid
 */
function normalizePhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') {
        return null;
    }
    // Remove all whitespace
    const cleaned = phone.trim();
    // Already in E.164 format
    if (PHONE_E164_REGEX.test(cleaned)) {
        return cleaned;
    }
    // 10 digits only
    if (PHONE_10_DIGIT_REGEX.test(cleaned)) {
        return `+1${cleaned}`;
    }
    // Formatted: (808)342-6751, 808-342-6751, 808.342.6751
    const formattedMatch = cleaned.match(PHONE_FORMATTED_REGEX);
    if (formattedMatch) {
        return `+1${formattedMatch[1]}${formattedMatch[2]}${formattedMatch[3]}`;
    }
    // Try stripping all non-digits
    const digitsOnly = cleaned.replace(/\D/g, '');
    // 11 digits starting with 1 (1-808-342-6751)
    if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
        return `+${digitsOnly}`;
    }
    // 10 digits after stripping
    if (digitsOnly.length === 10) {
        return `+1${digitsOnly}`;
    }
    return null; // Invalid
}
/**
 * Check if a phone number is valid
 */
function isValidPhoneNumber(phone) {
    return normalizePhoneNumber(phone) !== null;
}
/**
 * Send an SMS message with deduplication
 */
async function sendSms(userId, phone, messageType, body, dedupeKey, metadata) {
    const supabase = (0, supabase_client_1.getSupabaseClient)();
    // Validate and normalize phone number
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
        console.error(`Invalid phone number format: ${phone}`);
        return {
            success: false,
            error: `Invalid phone number format: ${phone}`,
        };
    }
    // Check for duplicate
    const { data: existing } = await supabase
        .from('message_log')
        .select('id')
        .eq('dedupe_key', dedupeKey)
        .single();
    if (existing) {
        return { success: true, deduplicated: true };
    }
    try {
        const twilio = await getTwilio();
        const fromNumber = getTwilioFromNumber();
        const message = await twilio.messages.create({
            body,
            from: fromNumber,
            to: normalizedPhone, // Use normalized phone
        });
        // Log message
        await supabase.from('message_log').insert({
            user_id: userId,
            message_type: messageType,
            dedupe_key: dedupeKey,
            channel: 'sms',
            metadata: metadata || null,
        });
        return { success: true, message_sid: message.sid };
    }
    catch (error) {
        console.error(`Failed to send SMS: ${error.message}`);
        // Log failed notification to database for retry/monitoring
        try {
            await supabase.from('failed_notifications').insert({
                user_id: userId,
                phone: normalizedPhone,
                message_type: messageType,
                message_body: body,
                error: error.message || 'Unknown error',
                error_code: error.code || null,
                retry_count: 0,
                created_at: new Date().toISOString(),
            });
        }
        catch (logError) {
            // Don't fail the whole operation if logging fails
            console.error(`Failed to log notification failure: ${logError.message}`);
        }
        return {
            success: false,
            error: error.message || 'Failed to send SMS',
        };
    }
}
// ============================================================================
// MESSAGE TEMPLATES
// ============================================================================
/**
 * Welcome message with location selection
 */
function getWelcomeMessage(locations) {
    const locationList = locations
        .map((loc) => `${loc.index}. ${loc.name}`)
        .join('\n');
    return `Welcome to DMV Bot!

Which location do you need?
${locationList}

Reply with the number of your choice.`;
}
/**
 * Location confirmed, tier selection
 */
function getTierSelectionMessage(locationName, standardDeposit, priorityDeposit) {
    return `${locationName} - got it!

How urgent is your appointment?

PRIORITY - Within 2 weeks ($${priorityDeposit / 100} deposit)
FLEXIBLE - 1-4 weeks ($${standardDeposit / 100} deposit)

Reply PRIORITY or FLEXIBLE`;
}
/**
 * Waitlist confirmation
 */
function getWaitlistConfirmedMessage(locationName, tier, depositAmount) {
    const tierLabel = tier === 'priority' ? 'Priority (within 2 weeks)' : 'Flexible (1-4 weeks)';
    return `You're on the waitlist!

Location: ${locationName}
Tier: ${tierLabel}
Deposit: $${depositAmount / 100} when invited

We'll text you when a queue spot opens.

Need a specific time of day? Reply TIME to set (not recommended - reduces available appointments)`;
}
/**
 * Invite message with payment link
 */
function getInviteMessage(locationName, depositAmount, paymentLink) {
    return `Great news!

A queue spot just opened at ${locationName}.

Pay your $${depositAmount / 100} deposit to secure your spot:
${paymentLink}

You have 24 hours to pay, or your spot goes to the next person.

Reply SKIP to stay on the waitlist instead.`;
}
/**
 * Deposit confirmed, in pre-queue
 */
function getDepositConfirmedMessage(locationName) {
    return `Deposit received!

You're now in the pre-queue for ${locationName}. You'll move to the active queue soon and we'll start matching you with appointments.

We'll text you the moment we book your appointment.`;
}
/**
 * Moved to active queue
 */
function getQueueEntryMessage(locationName, position) {
    return `You're now in the active queue!

Location: ${locationName}
Position: #${position}

We're actively matching you with available appointments. You'll be notified immediately when we book one for you.`;
}
/**
 * Booking successful
 */
async function getBookedMessage(locationName, appointmentDate, appointmentTime) {
    const formattedDate = formatDate(appointmentDate);
    const formattedTime = formatTime(appointmentTime);
    const cancelEnabled = await (0, config_service_1.isCancelWindowEnabled)();
    const cancelSeconds = await (0, config_service_1.getCancelWindowSeconds)();
    const cancelMinutes = Math.floor(cancelSeconds / 60);
    let cancelInfo = '';
    if (cancelEnabled) {
        cancelInfo = `\n\nReply CANCEL within ${cancelMinutes} minutes if you need to undo this. After that, the appointment is locked.`;
    }
    else {
        cancelInfo = '\n\nYour appointment is confirmed! See you there.';
    }
    return `Appointment Booked!

Location: ${locationName}
Date: ${formattedDate}
Time: ${formattedTime}${cancelInfo}`;
}
/**
 * Booking confirmed (cancel window expired)
 */
function getBookingConfirmedMessage(locationName, appointmentDate, appointmentTime) {
    const formattedDate = formatDate(appointmentDate);
    const formattedTime = formatTime(appointmentTime);
    return `Appointment Confirmed!

Your ${locationName} appointment is locked in:

Date: ${formattedDate}
Time: ${formattedTime}

See you there!`;
}
/**
 * Payment failed
 */
function getPaymentFailedMessage(locationName, queuePosition) {
    const positionInfo = queuePosition ? `\nYour queue spot (#${queuePosition}) is saved.` : '';
    return `Payment Failed

Your card couldn't be charged for a ${locationName} appointment.

You're paused until you update your payment method.${positionInfo}

Reply CARD to update your payment method.`;
}
/**
 * Card updated successfully
 */
function getCardUpdatedMessage() {
    return `Payment method updated!

You're back in the active queue. We'll continue matching you with available appointments.`;
}
/**
 * Cancellation confirmed
 */
function getCancelConfirmedMessage(locationName, appointmentDate, refundAmount) {
    let message = 'Appointment Canceled\n\n';
    if (appointmentDate) {
        message += `Your ${locationName} appointment for ${formatDate(appointmentDate)} has been canceled.\n\n`;
    }
    else {
        message += `Your ${locationName} queue entry has been canceled.\n\n`;
    }
    if (refundAmount && refundAmount > 0) {
        message += `Your $${refundAmount / 100} will be refunded within 5-10 business days.\n\n`;
    }
    message += 'Want to try again? Reply START to rejoin the waitlist.';
    return message;
}
/**
 * Invite expired
 */
function getInviteExpiredMessage(locationName) {
    return `Invite Expired

Your 24-hour window to pay the deposit for ${locationName} has passed.

You've been moved back to the waitlist. We'll invite you again when a spot opens.

Reply CANCEL if you no longer need an appointment.`;
}
/**
 * Status message
 */
function getStatusMessage(state, locationName, tier, position, appointmentInfo) {
    let statusText = '';
    switch (state) {
        case 'waiting':
            statusText = `You're on the waitlist for ${locationName} (${tier} tier).`;
            break;
        case 'invited':
            statusText = `You've been invited to join the queue at ${locationName}. Check your messages for the payment link.`;
            break;
        case 'ready':
            statusText = `You're in the pre-queue for ${locationName}. You'll move to the active queue soon.`;
            break;
        case 'active':
            statusText = `You're in the active queue for ${locationName}${position ? ` at position #${position}` : ''}. We're matching you with appointments.`;
            break;
        case 'booking':
            statusText = `We're currently booking an appointment for you at ${locationName}. Please wait...`;
            break;
        case 'booked':
            if (appointmentInfo) {
                statusText = `Your ${locationName} appointment is booked for ${formatDate(appointmentInfo.date)} at ${formatTime(appointmentInfo.time)}.`;
            }
            else {
                statusText = `Your appointment is booked. Check your messages for details.`;
            }
            break;
        case 'confirmed':
            if (appointmentInfo) {
                statusText = `Your ${locationName} appointment is confirmed for ${formatDate(appointmentInfo.date)} at ${formatTime(appointmentInfo.time)}.`;
            }
            else {
                statusText = `Your appointment is confirmed. Check your messages for details.`;
            }
            break;
        case 'payment_issue':
            statusText = `Your account is paused due to a payment issue. Reply CARD to update your payment method.`;
            break;
        default:
            statusText = `Status: ${state}`;
    }
    return `Current Status\n\n${statusText}`;
}
/**
 * Help message
 */
function getHelpMessage() {
    return `DMV Bot Commands

STATUS - Check your current position
CANCEL - Cancel and request refund
CARD - Update payment method
TIME - Set time preference
HELP - Show this message

Questions? Just reply and we'll help!`;
}
/**
 * Booking submit failed message (charged but submit failed)
 */
function getBookingSubmitFailedMessage(locationName) {
    return `Technical Issue

We encountered a problem while finalizing your ${locationName} appointment.

Your card has been refunded. You're still in the queue and we'll match you with the next available slot.

Sorry for the inconvenience!`;
}
// ============================================================================
// CONVENIENCE METHODS
// ============================================================================
/**
 * Send invite message
 */
async function sendInviteMessage(userId, phone, locationName, depositAmount, paymentLink, inviteNumber) {
    const body = getInviteMessage(locationName, depositAmount, paymentLink);
    const dedupeKey = `${userId}_invite_${inviteNumber}`;
    return sendSms(userId, phone, 'invite', body, dedupeKey, {
        location: locationName,
        deposit_amount: depositAmount,
        invite_number: inviteNumber,
    });
}
/**
 * Send booked message
 */
async function sendBookedMessage(userId, phone, locationName, appointmentDate, appointmentTime, slotId) {
    const body = await getBookedMessage(locationName, appointmentDate, appointmentTime);
    const dedupeKey = `${userId}_booked_${slotId}`;
    return sendSms(userId, phone, 'booked', body, dedupeKey, {
        location: locationName,
        appointment_date: appointmentDate,
        appointment_time: appointmentTime,
        slot_id: slotId,
    });
}
/**
 * Send payment failed message
 */
async function sendPaymentFailedMessage(userId, phone, locationName, failureNumber, queuePosition) {
    const body = getPaymentFailedMessage(locationName, queuePosition);
    const dedupeKey = `${userId}_payment_failed_${failureNumber}`;
    return sendSms(userId, phone, 'payment_failed', body, dedupeKey, {
        location: locationName,
        failure_number: failureNumber,
        queue_position: queuePosition,
    });
}
/**
 * Send booking submit failed message
 */
async function sendBookingSubmitFailedMessage(userId, phone, locationName, slotId) {
    const body = getBookingSubmitFailedMessage(locationName);
    const dedupeKey = `${userId}_submit_failed_${slotId}`;
    return sendSms(userId, phone, 'booking_submit_failed', body, dedupeKey, {
        location: locationName,
        slot_id: slotId,
    });
}
// ============================================================================
// HELPERS
// ============================================================================
/**
 * Format date string (YYYY-MM-DD) to readable format
 */
function formatDate(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}
/**
 * Format time string (HH:MM:SS) to readable format
 */
function formatTime(timeStr) {
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
}
