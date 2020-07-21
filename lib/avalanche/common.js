/*!
 * common.js common avalanche variables
 * Copyright (c) 2020, Jonathan (MIT License)
 * https://github.com/rojii/bcash
 */


'use strict';

/**
 * @module avalanche/common
 */

const assert = require('bsert');

/**
 * Proof types
 * @enum {Number}
 */

exports.types = {
  NONE: 0x00,
  NO_STAKE: 0x01,
  DUST_THRESOLD: 0x02,
  DUPLICATE_STAKE: 0x03,
  INVALID_SIGNATURE: 0x04
};

/**
 * Proof types by value.
 * @const {Object}
 */

exports.typesByVal = {
  0: 'NONE',
  1: 'NO_STAKE',
  2: 'DUST_THRESOLD',
  3: 'DUPLICATE_STAKE',
  4: 'INVALID_SIGNATURE'
};
