// Queue System V2 - Service Exports
// See openspec/specs/ for full documentation

// State Machine
export {
  VALID_TRANSITIONS,
  TERMINAL_STATES,
  isValidTransition,
  transitionState,
  bulkTransitionState,
  getQueueEntryState,
  isInTerminalState,
  type TransitionContext,
  type TransitionResult,
} from './state_machine';

// Queue Service
export {
  createQueueEntry,
  getQueueEntry,
  getQueueEntryByUserAndLocation,
  getQueueEntriesByUser,
  getQueueCounts,
  processQueuePromotions,
  selectUsersForBooking,
  releaseUsersFromBooking,
  type CreateQueueEntryParams,
  type QueueCounts,
  type SelectedUser,
} from './queue_service';

// User Service
export {
  createUser,
  getUser,
  getUsersByIds,
  getUserByPhone,
  getOrCreateUser,
  updateUser,
  setStripeCustomerId,
  getUserWithQueueInfo,
  // Factory pattern for testing
  createUserService,
  userService,
  type CreateUserParams,
  type UserWithQueueInfo,
  type UserService,
} from './user_service';

// Location Service
export {
  LOCATION_CODES,
  LOCATION_NAMES,
  getLocationCode,
  getLocationName,
  getLocation,
  getLocationByName,
  getActiveLocations,
  getAllLocations,
  updateLocation,
  getPricing,
  getLocationPricing,
} from './location_service';

// Config Service
export {
  CONFIG_KEYS,
  getConfig,
  getConfigWithDefault,
  setConfig,
  getAllConfig,
  getDepositPaymentWindowHours,
  isCancelWindowEnabled,
  getCancelWindowSeconds,
  getPaymentIssueTimeoutDays,
  getFlexibleWindowDays,
  getPriorityWindowDays,
} from './config_service';

// Slot Lock Service
export {
  acquireSlotLock,
  releaseSlotLock,
  getSlotLock,
  isSlotLocked,
  getActiveLocksForLocation,
  releaseAllLocksForBot,
} from './slot_lock_service';

// Cleanup Service
export {
  resetStuckBookings,
  expireOldInvites,
  cleanupExpiredSlotLocks,
  expirePaymentIssues,
  processExpiredCancelWindows,
  runCleanupJobs,
  type CleanupResults,
} from './cleanup_service';

// Payment Service
export {
  createStripeCustomer,
  getOrCreateStripeCustomer,
  attachPaymentMethod,
  chargeDeposit,
  chargeBookingFee,
  refundDeposit,
  refundBookingFee,
  refundBookingFeeByChargeId,
  validatePaymentMethod,
  createDepositPaymentLink,
  type ChargeResult,
  type RefundResult,
  type CustomerResult,
} from './payment_service';

// Notification Service
export {
  sendSms,
  normalizePhoneNumber,
  isValidPhoneNumber,
  getWelcomeMessage,
  getTierSelectionMessage,
  getWaitlistConfirmedMessage,
  getInviteMessage,
  getDepositConfirmedMessage,
  getQueueEntryMessage,
  getBookedMessage,
  getBookingConfirmedMessage,
  getPaymentFailedMessage,
  getBookingSubmitFailedMessage,
  getCardUpdatedMessage,
  getCancelConfirmedMessage,
  getInviteExpiredMessage,
  getStatusMessage,
  getHelpMessage,
  sendInviteMessage,
  sendBookedMessage,
  sendPaymentFailedMessage,
  sendBookingSubmitFailedMessage,
  type SendSmsResult,
} from './notification_service';
