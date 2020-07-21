/*!
 * proof.js - proof generator for avalache
 * Copyright (C) 2020, Jonathan Gonzalez (MIT License).
 * https://github.com/rojii/bcash
 */

'use strict';

const assert = require('bsert');
const bio = require('bufio');
const secp256k1 = require('bcrypto/lib/secp256k1');
const sha256 = require('bcrypto/lib/sha256');
const random = require('bcrypto/lib/random');
const common = require('./common');


/*
 * Constants
 */

const DUMMY32 = Buffer.allocUnsafe(0x20);

/**
 * Proof
 * represents an proof
 * @alias module:avalanche.Proof
 */

class Proof {
  constructor(options) {
    this._sequence = null;
    this._expiration = null;
    this._hash = null;


    if (options)
      this.fromOptions(options);
  }

  hash(enc) {
    let h = this._hash;

    if (!h) {
      h = sha256.digest(this.toRaw());
    }

    return h;
  }

  sign(proof) {

    if (proof == null)
      proof = random.randomBytes(0x20);

    let h = this.hash(proof);
    let sig = DUMMY32;

    if (secp256k1.schnorrSign(h, sig)) {
      sig.slice(0, -1);
    } else {
      sig.fill(0);
    }

    return sig;
  }

  toRaw() {
    const data = random.randomBytes(32);
    return data;
    }

  /**
   * Inject properties from string.
   * @private
   * @param {String} proof
   * @returns {Proof}
   */

  fromString(proof) {
    assert(typeof proof === 'string');

    const bw = bio.write();

    return this.fromRaw(bw.render());
  }

  toString() {
    const out = [];

    return out.join(' ');
  }

  fromRaw(data) {
    const br = bio.read(data);

    this.proof = data;

    return this;
  }

  /**
   * Parse a proof string
   * into an script object.
   * @param {String} items - Proof string.
   * @returns {Proof}
   * @throws Parse error.
   */

  static fromString(proof) {
    return new this().fromString(proof);
  }

  /**
   * Create a Proof from a serialized buffer.
   * @param {Buffer|String} data - Serialized proof.
   * @param {String?} enc - Either `"hex"` or `null`.
   * @returns {Proof}
   */

  static fromRaw(data, enc) {
    if (typeof data === 'string')
      data = Buffer.from(data, enc);

    return new this().fromRaw(data);
  }

  static sign(proof) {
   return new this().sign(proof);
  }

  static hash(proof) {
    return new this().hash();
  }

  static verify(proof) {
    let stake = new Stake();
    return stake.verify(proof.hash);
  }
}

Proof.types = common.types;

/*
 * Expose
 */

module.exports = Proof;
