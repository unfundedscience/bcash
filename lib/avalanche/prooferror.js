/*!
 * prooferror.js - proof error for bcash
 * Copyright (C) 2020, Jonathan Gonzalez (MIT License).
 * https://github.com/rojii/bcash
 */

'use strict';

/**
 * Proof Error
 * An error thrown from the Avalanche Protocol,
 * potentially pertaining to Transaction execution.
 * @alias module:avalanche.ProofError
 * @extends Error
 * @property {String} messaage - Error message.
 * @property {Number} value
 */

class ProofError extends Error {
  /**
   * Create an error.
   * @constructor
   * @param {String} code - Error code.
   * @param {Number?} value
   */

  constructor(code, value) {
    super();

    this.type = 'ProofError';
    this.code = code;
    this.message = code;
    this.value = -1;

    if (typeof value === 'string')
      this.message = value;

    if (Error.captureStackTrace)
      Error.captureStackTrace(this, ProofError);
  }
}



/*
 * Expose
 */

module.exports = ProofError;
