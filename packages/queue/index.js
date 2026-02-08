"use strict";
// Queue System V2 - Service Exports
// See openspec/specs/ for full documentation
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSlotLocked = exports.getSlotLock = exports.releaseSlotLock = exports.acquireSlotLock = exports.getPriorityWindowDays = exports.getFlexibleWindowDays = exports.getPaymentIssueTimeoutDays = exports.getCancelWindowSeconds = exports.isCancelWindowEnabled = exports.getDepositPaymentWindowHours = exports.getAllConfig = exports.setConfig = exports.getConfigWithDefault = exports.getConfig = exports.CONFIG_KEYS = exports.getLocationPricing = exports.getPricing = exports.updateLocation = exports.getAllLocations = exports.getActiveLocations = exports.getLocationByName = exports.getLocation = exports.getLocationByCode = exports.getLocationName = exports.getLocationCode = exports.userService = exports.createUserService = exports.getUserWithQueueInfo = exports.setStripeCustomerId = exports.updateUser = exports.getOrCreateUser = exports.getUserByPhone = exports.getUsersByIds = exports.getUser = exports.createUser = exports.releaseUsersFromBooking = exports.selectUsersForBooking = exports.processQueuePromotions = exports.getQueueCounts = exports.getQueueEntriesByUser = exports.getQueueEntryByUserAndLocation = exports.getQueueEntry = exports.createQueueEntry = exports.isInTerminalState = exports.getQueueEntryState = exports.bulkTransitionState = exports.transitionState = exports.isValidTransition = exports.TERMINAL_STATES = exports.VALID_TRANSITIONS = void 0;
exports.sendBookingSubmitFailedMessage = exports.sendPaymentFailedMessage = exports.sendBookedMessage = exports.sendInviteMessage = exports.getHelpMessage = exports.getStatusMessage = exports.getInviteExpiredMessage = exports.getCancelConfirmedMessage = exports.getCardUpdatedMessage = exports.getBookingSubmitFailedMessage = exports.getPaymentFailedMessage = exports.getBookingConfirmedMessage = exports.getBookedMessage = exports.getQueueEntryMessage = exports.getDepositConfirmedMessage = exports.getInviteMessage = exports.getWaitlistConfirmedMessage = exports.getTierSelectionMessage = exports.getWelcomeMessage = exports.isValidPhoneNumber = exports.normalizePhoneNumber = exports.sendSms = exports.createDepositPaymentLink = exports.validatePaymentMethod = exports.refundBookingFeeByChargeId = exports.refundBookingFee = exports.refundDeposit = exports.chargeBookingFee = exports.chargeDeposit = exports.attachPaymentMethod = exports.getOrCreateStripeCustomer = exports.createStripeCustomer = exports.runCleanupJobs = exports.processExpiredCancelWindows = exports.expirePaymentIssues = exports.cleanupExpiredSlotLocks = exports.expireOldInvites = exports.resetStuckBookings = exports.releaseAllLocksForBot = exports.getActiveLocksForLocation = void 0;
// State Machine
var state_machine_1 = require("./state_machine");
Object.defineProperty(exports, "VALID_TRANSITIONS", { enumerable: true, get: function () { return state_machine_1.VALID_TRANSITIONS; } });
Object.defineProperty(exports, "TERMINAL_STATES", { enumerable: true, get: function () { return state_machine_1.TERMINAL_STATES; } });
Object.defineProperty(exports, "isValidTransition", { enumerable: true, get: function () { return state_machine_1.isValidTransition; } });
Object.defineProperty(exports, "transitionState", { enumerable: true, get: function () { return state_machine_1.transitionState; } });
Object.defineProperty(exports, "bulkTransitionState", { enumerable: true, get: function () { return state_machine_1.bulkTransitionState; } });
Object.defineProperty(exports, "getQueueEntryState", { enumerable: true, get: function () { return state_machine_1.getQueueEntryState; } });
Object.defineProperty(exports, "isInTerminalState", { enumerable: true, get: function () { return state_machine_1.isInTerminalState; } });
// Queue Service
var queue_service_1 = require("./queue_service");
Object.defineProperty(exports, "createQueueEntry", { enumerable: true, get: function () { return queue_service_1.createQueueEntry; } });
Object.defineProperty(exports, "getQueueEntry", { enumerable: true, get: function () { return queue_service_1.getQueueEntry; } });
Object.defineProperty(exports, "getQueueEntryByUserAndLocation", { enumerable: true, get: function () { return queue_service_1.getQueueEntryByUserAndLocation; } });
Object.defineProperty(exports, "getQueueEntriesByUser", { enumerable: true, get: function () { return queue_service_1.getQueueEntriesByUser; } });
Object.defineProperty(exports, "getQueueCounts", { enumerable: true, get: function () { return queue_service_1.getQueueCounts; } });
Object.defineProperty(exports, "processQueuePromotions", { enumerable: true, get: function () { return queue_service_1.processQueuePromotions; } });
Object.defineProperty(exports, "selectUsersForBooking", { enumerable: true, get: function () { return queue_service_1.selectUsersForBooking; } });
Object.defineProperty(exports, "releaseUsersFromBooking", { enumerable: true, get: function () { return queue_service_1.releaseUsersFromBooking; } });
// User Service
var user_service_1 = require("./user_service");
Object.defineProperty(exports, "createUser", { enumerable: true, get: function () { return user_service_1.createUser; } });
Object.defineProperty(exports, "getUser", { enumerable: true, get: function () { return user_service_1.getUser; } });
Object.defineProperty(exports, "getUsersByIds", { enumerable: true, get: function () { return user_service_1.getUsersByIds; } });
Object.defineProperty(exports, "getUserByPhone", { enumerable: true, get: function () { return user_service_1.getUserByPhone; } });
Object.defineProperty(exports, "getOrCreateUser", { enumerable: true, get: function () { return user_service_1.getOrCreateUser; } });
Object.defineProperty(exports, "updateUser", { enumerable: true, get: function () { return user_service_1.updateUser; } });
Object.defineProperty(exports, "setStripeCustomerId", { enumerable: true, get: function () { return user_service_1.setStripeCustomerId; } });
Object.defineProperty(exports, "getUserWithQueueInfo", { enumerable: true, get: function () { return user_service_1.getUserWithQueueInfo; } });
// Factory pattern for testing
Object.defineProperty(exports, "createUserService", { enumerable: true, get: function () { return user_service_1.createUserService; } });
Object.defineProperty(exports, "userService", { enumerable: true, get: function () { return user_service_1.userService; } });
// Location Service
var location_service_1 = require("./location_service");
Object.defineProperty(exports, "getLocationCode", { enumerable: true, get: function () { return location_service_1.getLocationCode; } });
Object.defineProperty(exports, "getLocationName", { enumerable: true, get: function () { return location_service_1.getLocationName; } });
Object.defineProperty(exports, "getLocationByCode", { enumerable: true, get: function () { return location_service_1.getLocationByCode; } });
Object.defineProperty(exports, "getLocation", { enumerable: true, get: function () { return location_service_1.getLocation; } });
Object.defineProperty(exports, "getLocationByName", { enumerable: true, get: function () { return location_service_1.getLocationByName; } });
Object.defineProperty(exports, "getActiveLocations", { enumerable: true, get: function () { return location_service_1.getActiveLocations; } });
Object.defineProperty(exports, "getAllLocations", { enumerable: true, get: function () { return location_service_1.getAllLocations; } });
Object.defineProperty(exports, "updateLocation", { enumerable: true, get: function () { return location_service_1.updateLocation; } });
Object.defineProperty(exports, "getPricing", { enumerable: true, get: function () { return location_service_1.getPricing; } });
Object.defineProperty(exports, "getLocationPricing", { enumerable: true, get: function () { return location_service_1.getLocationPricing; } });
// Config Service
var config_service_1 = require("./config_service");
Object.defineProperty(exports, "CONFIG_KEYS", { enumerable: true, get: function () { return config_service_1.CONFIG_KEYS; } });
Object.defineProperty(exports, "getConfig", { enumerable: true, get: function () { return config_service_1.getConfig; } });
Object.defineProperty(exports, "getConfigWithDefault", { enumerable: true, get: function () { return config_service_1.getConfigWithDefault; } });
Object.defineProperty(exports, "setConfig", { enumerable: true, get: function () { return config_service_1.setConfig; } });
Object.defineProperty(exports, "getAllConfig", { enumerable: true, get: function () { return config_service_1.getAllConfig; } });
Object.defineProperty(exports, "getDepositPaymentWindowHours", { enumerable: true, get: function () { return config_service_1.getDepositPaymentWindowHours; } });
Object.defineProperty(exports, "isCancelWindowEnabled", { enumerable: true, get: function () { return config_service_1.isCancelWindowEnabled; } });
Object.defineProperty(exports, "getCancelWindowSeconds", { enumerable: true, get: function () { return config_service_1.getCancelWindowSeconds; } });
Object.defineProperty(exports, "getPaymentIssueTimeoutDays", { enumerable: true, get: function () { return config_service_1.getPaymentIssueTimeoutDays; } });
Object.defineProperty(exports, "getFlexibleWindowDays", { enumerable: true, get: function () { return config_service_1.getFlexibleWindowDays; } });
Object.defineProperty(exports, "getPriorityWindowDays", { enumerable: true, get: function () { return config_service_1.getPriorityWindowDays; } });
// Slot Lock Service
var slot_lock_service_1 = require("./slot_lock_service");
Object.defineProperty(exports, "acquireSlotLock", { enumerable: true, get: function () { return slot_lock_service_1.acquireSlotLock; } });
Object.defineProperty(exports, "releaseSlotLock", { enumerable: true, get: function () { return slot_lock_service_1.releaseSlotLock; } });
Object.defineProperty(exports, "getSlotLock", { enumerable: true, get: function () { return slot_lock_service_1.getSlotLock; } });
Object.defineProperty(exports, "isSlotLocked", { enumerable: true, get: function () { return slot_lock_service_1.isSlotLocked; } });
Object.defineProperty(exports, "getActiveLocksForLocation", { enumerable: true, get: function () { return slot_lock_service_1.getActiveLocksForLocation; } });
Object.defineProperty(exports, "releaseAllLocksForBot", { enumerable: true, get: function () { return slot_lock_service_1.releaseAllLocksForBot; } });
// Cleanup Service
var cleanup_service_1 = require("./cleanup_service");
Object.defineProperty(exports, "resetStuckBookings", { enumerable: true, get: function () { return cleanup_service_1.resetStuckBookings; } });
Object.defineProperty(exports, "expireOldInvites", { enumerable: true, get: function () { return cleanup_service_1.expireOldInvites; } });
Object.defineProperty(exports, "cleanupExpiredSlotLocks", { enumerable: true, get: function () { return cleanup_service_1.cleanupExpiredSlotLocks; } });
Object.defineProperty(exports, "expirePaymentIssues", { enumerable: true, get: function () { return cleanup_service_1.expirePaymentIssues; } });
Object.defineProperty(exports, "processExpiredCancelWindows", { enumerable: true, get: function () { return cleanup_service_1.processExpiredCancelWindows; } });
Object.defineProperty(exports, "runCleanupJobs", { enumerable: true, get: function () { return cleanup_service_1.runCleanupJobs; } });
// Payment Service
var payment_service_1 = require("./payment_service");
Object.defineProperty(exports, "createStripeCustomer", { enumerable: true, get: function () { return payment_service_1.createStripeCustomer; } });
Object.defineProperty(exports, "getOrCreateStripeCustomer", { enumerable: true, get: function () { return payment_service_1.getOrCreateStripeCustomer; } });
Object.defineProperty(exports, "attachPaymentMethod", { enumerable: true, get: function () { return payment_service_1.attachPaymentMethod; } });
Object.defineProperty(exports, "chargeDeposit", { enumerable: true, get: function () { return payment_service_1.chargeDeposit; } });
Object.defineProperty(exports, "chargeBookingFee", { enumerable: true, get: function () { return payment_service_1.chargeBookingFee; } });
Object.defineProperty(exports, "refundDeposit", { enumerable: true, get: function () { return payment_service_1.refundDeposit; } });
Object.defineProperty(exports, "refundBookingFee", { enumerable: true, get: function () { return payment_service_1.refundBookingFee; } });
Object.defineProperty(exports, "refundBookingFeeByChargeId", { enumerable: true, get: function () { return payment_service_1.refundBookingFeeByChargeId; } });
Object.defineProperty(exports, "validatePaymentMethod", { enumerable: true, get: function () { return payment_service_1.validatePaymentMethod; } });
Object.defineProperty(exports, "createDepositPaymentLink", { enumerable: true, get: function () { return payment_service_1.createDepositPaymentLink; } });
// Notification Service
var notification_service_1 = require("./notification_service");
Object.defineProperty(exports, "sendSms", { enumerable: true, get: function () { return notification_service_1.sendSms; } });
Object.defineProperty(exports, "normalizePhoneNumber", { enumerable: true, get: function () { return notification_service_1.normalizePhoneNumber; } });
Object.defineProperty(exports, "isValidPhoneNumber", { enumerable: true, get: function () { return notification_service_1.isValidPhoneNumber; } });
Object.defineProperty(exports, "getWelcomeMessage", { enumerable: true, get: function () { return notification_service_1.getWelcomeMessage; } });
Object.defineProperty(exports, "getTierSelectionMessage", { enumerable: true, get: function () { return notification_service_1.getTierSelectionMessage; } });
Object.defineProperty(exports, "getWaitlistConfirmedMessage", { enumerable: true, get: function () { return notification_service_1.getWaitlistConfirmedMessage; } });
Object.defineProperty(exports, "getInviteMessage", { enumerable: true, get: function () { return notification_service_1.getInviteMessage; } });
Object.defineProperty(exports, "getDepositConfirmedMessage", { enumerable: true, get: function () { return notification_service_1.getDepositConfirmedMessage; } });
Object.defineProperty(exports, "getQueueEntryMessage", { enumerable: true, get: function () { return notification_service_1.getQueueEntryMessage; } });
Object.defineProperty(exports, "getBookedMessage", { enumerable: true, get: function () { return notification_service_1.getBookedMessage; } });
Object.defineProperty(exports, "getBookingConfirmedMessage", { enumerable: true, get: function () { return notification_service_1.getBookingConfirmedMessage; } });
Object.defineProperty(exports, "getPaymentFailedMessage", { enumerable: true, get: function () { return notification_service_1.getPaymentFailedMessage; } });
Object.defineProperty(exports, "getBookingSubmitFailedMessage", { enumerable: true, get: function () { return notification_service_1.getBookingSubmitFailedMessage; } });
Object.defineProperty(exports, "getCardUpdatedMessage", { enumerable: true, get: function () { return notification_service_1.getCardUpdatedMessage; } });
Object.defineProperty(exports, "getCancelConfirmedMessage", { enumerable: true, get: function () { return notification_service_1.getCancelConfirmedMessage; } });
Object.defineProperty(exports, "getInviteExpiredMessage", { enumerable: true, get: function () { return notification_service_1.getInviteExpiredMessage; } });
Object.defineProperty(exports, "getStatusMessage", { enumerable: true, get: function () { return notification_service_1.getStatusMessage; } });
Object.defineProperty(exports, "getHelpMessage", { enumerable: true, get: function () { return notification_service_1.getHelpMessage; } });
Object.defineProperty(exports, "sendInviteMessage", { enumerable: true, get: function () { return notification_service_1.sendInviteMessage; } });
Object.defineProperty(exports, "sendBookedMessage", { enumerable: true, get: function () { return notification_service_1.sendBookedMessage; } });
Object.defineProperty(exports, "sendPaymentFailedMessage", { enumerable: true, get: function () { return notification_service_1.sendPaymentFailedMessage; } });
Object.defineProperty(exports, "sendBookingSubmitFailedMessage", { enumerable: true, get: function () { return notification_service_1.sendBookingSubmitFailedMessage; } });
