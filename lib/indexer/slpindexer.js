/*!
 * txindexer.js - transaction indexer for bcoin
 * Copyright (c) 2018, the bcoin developers (MIT License).
 * https://github.com/bcoin-org/bcoin
 */

'use strict';

const assert = require('bsert');
const bdb = require('bdb');
const bio = require('bufio');
const {U64} = require('n64');
const layout = require('./layout');
const consensus = require('../protocol/consensus');
const TX = require('../primitives/tx');
const Block = require('../primitives/block');
const TXMeta = require('../primitives/txmeta');
const Indexer = require('./indexer');
const SLP = require('../script/slp');

/**
 * SLPIndexer Database Layout:
 *  S[hash_index] -> TokenRecord
 *  s[hash_index][vout_index] -> SlpCoinRecord
 *  i[hash] -> hash_index
 *  I[hash_index] -> tx hash
 *  b[height] -> BlockRecord
 *  t[hash] -> tx record
 *
 * The token index stores a record corresponding with the GENESIS
 * metadata. The SLP index stores a record for each coin with that
 * contains some amount of token value.
 * To save space, there are additional lookup tables allowing
 * the transaction hash is associated with a 32 bit integer
 */

Object.assign(layout, {
  S: bdb.key('S', ['uint32']),
  s: bdb.key('s', ['uint32', 'uint32']),
  i: bdb.key('i', ['hash256']),
  b: bdb.key('b', ['uint32']),
  t: bdb.key('t', ['hash256'])
});


/**
 * Increment 32-bit big endian
 * @param {Buffer} hashIndBuf
 * @returns {Buffer}
 */
function incrementUInt32BE (hashIndBuf) {
  assert(hashIndBuf.length == 4, 'Buffer length must be 4 bytes')

  const newNumData = Buffer.alloc(4);
  const hashIndNum = U64.readBE(hashIndBuf, -4).addn(1);
  assert(hashIndNum.lte(U64.UINT32_MAX), 'Increment limit reached for UInt32')

  hashIndNum.writeBE(newNumData, -4);
  return newNumData
}

/**
 * 32-bit big endian to Number (int)
 * @param {Buffer} hashIndBuf
 * @returns {Number}
 */
 function uInt32BEToInt (hashIndBuf) {
  assert(hashIndBuf.length == 4, 'Buffer length must be 4 bytes');

  const hashIndInt = U64.readBE(hashIndBuf, -4).toInt();
  assert(typeof hashIndInt == 'number');

  return hashIndInt;
}

/**
 * Block Record
 */

class BlockRecord {
  /**
   * Create a block record.
   * @constructor
   */

  constructor(options = {}) {
    this.start = options.start;
    this.last = options.last;

    if (this.start)
      assert(this.start.length === 4, 'start buffer must be 4 bytes in length');
    if (this.last)
      assert(this.last.length === 4, 'start buffer must be 4 bytes in length');
  }

  /**
   * Inject properties from serialized data.
   * @private
   * @param {Buffer} data
   */

  fromRaw(data) {
    const br = bio.read(data);

    this.start = br.readBytes(4);
    this.last = br.readBytes(4);

    return this;
  }

  /**
   * Instantiate block record from serialized data.
   * @param {Buffer} start
   * @param {Buffer} last
   * @returns {BlockRecord}
   */

  static fromRaw(data) {
    return new this().fromRaw(data);
  }

  /**
   * Serialize the block record.
   * @returns {Buffer}
   */

  toRaw() {
    assert(this.last.length === 4);
    assert(this.start.length === 4);
    const bw = bio.write(8);

    bw.writeBytes(this.start);
    bw.writeBytes(this.last);

    return bw.render();
  }
}

/**
 * Block Record compatible with TX db
 */

class TXBlockRecord {
  /**
   * Create a block record.
   * @constructor
   */

  constructor(options = {}) {
    this.block = options.block || consensus.ZERO_HASH;
    this.time = options.time || 0;

    assert(this.block.length === 32);
    assert((this.time >>> 0) === this.time);
  }

  /**
   * Inject properties from serialized data.
   * @private
   * @param {Buffer} data
   */

  fromRaw(data) {
    const br = bio.read(data);

    this.block = br.readHash();
    this.time = br.readU32();

    return this;
  }

  /**
   * Instantiate block record from serialized data.
   * @param {Hash} hash
   * @param {Buffer} data
   * @returns {BlockRecord}
   */

  static fromRaw(data) {
    return new this().fromRaw(data);
  }

  /**
   * Serialize the block record.
   * @returns {Buffer}
   */

  toRaw() {
    const bw = bio.write(36);

    bw.writeHash(this.block);
    bw.writeU32(this.time);

    return bw.render();
  }
}

/**
 * Transaction Record
 */

class TxRecord {
  /**
   * Create a transaction record.
   * @constructor
   */

  constructor(options = {}) {
    this.height = options.height || 0;
    this.index = options.index || 0;
    this.offset = options.offset || 0;
    this.length = options.length || 0;

    assert((this.height >>> 0) === this.height);
    assert((this.index >>> 0) === this.index);
    assert((this.offset >>> 0) === this.offset);
    assert((this.length >>> 0) === this.length);
  }

  /**
   * Inject properties from serialized data.
   * @private
   * @param {Buffer} data
   */

  fromRaw(data) {
    const br = bio.read(data);

    this.height = br.readU32();
    this.index = br.readU32();
    this.offset = br.readU32();
    this.length = br.readU32();

    return this;
  }

  /**
   * Instantiate transaction record from serialized data.
   * @param {Hash} hash
   * @param {Buffer} data
   * @returns {TxRecord}
   */

  static fromRaw(data) {
    return new this().fromRaw(data);
  }

  /**
   * Serialize the transaction record.
   * @returns {Buffer}
   */

  toRaw() {
    const bw = bio.write(16);

    bw.writeU32(this.height);
    bw.writeU32(this.index);
    bw.writeU32(this.offset);
    bw.writeU32(this.length);

    return bw.render();
  }
}

/**
 * TXIndexer
 * @alias module:indexer.SLPIndexer
 * @extends Indexer
 */

class SLPIndexer extends Indexer {
  /**
   * Create a indexer
   * @constructor
   * @param {Object} options
   */

  constructor(options) {
    super('slp', options);

    this.db = bdb.create(this.options);
    this.txdb = options.txdb;
  }

  /**
   * Index transactions by txid.
   * @private
   * @param {BlockMeta} meta
   * @param {Block} block
   * @param {CoinView} view
   */

  async indexBlock(meta, block, view) {
    assert(block.hasRaw(), 'Expected raw data for block.');

    // Find key to begin incrementing tx_hash <-> index
    const lastHashIndex = await this.getLastHashIndex(meta.height);

    const brecord = new BlockRecord({
      start: lastHashIndex,
      last: lastHashIndex
    });

    // Initialize toAdd object
    const toAdd = {};
    const hashIndexes = {}

    // Loop through txs in block to find valid SLP transactions
    const bblock = block.txs[0]._block ? block : Block.fromRaw(block.toRaw());
    for (let i = 0; i < bblock.txs.length; i++) {
      const tx = bblock.txs[i];

      const { records } = this.buildSlpRecords(tx)

      if (records.length > 0) {
        toAdd[tx.hash('hex')] = {
          isValid: true,
          isProcessed: false,
          prevouts: tx.inputs.map(input => input.prevout),
          records
        };
      }
    }

    /** 
     * Handling the post-processing object
     * 1. Object = tx hash key -> {prevouts: [], records: []}
     * 2. roll through for loop (use Object.keys()) to see if values for prevouts are in db (token values)
     * 3. if any prevout tx is in post-processing object (mempool chain), reset iterator to index (use Object.keys()) of that tx **-1** and continue
     * 4. if sufficient prevouts (to make valid) are in db, add records for tx to db and remove entry from post processing object, then reset interator to -1 and continue 
     * 5. if neither condition 3 or 4 above is true, entry is invalid. Remove entry from post processing object, then reset interator to -1 and continue
     */
    const toAddKeys = Object.keys(toAdd);

    for (let i = 0; i < toAddKeys.length; i++) {
      const key = toAddKeys[i];
      if (toAdd[key].isProcessed)
        continue;

      const version = toAdd[key].records[0].version // Token type 1 or 2
      let type = 'SEND';
      let foundMintBaton = false;
      let inputTotal = U64.fromInt(0);
      let outputTotal = U64.fromInt(0);
      for (let j = 0; j < toAdd[key].records.length; j++) {
        const record = toAdd[key].records[j];
        // if this is a Genesis transaction, it's automatically valid.
        if (record.decimals != undefined) {
          type = 'GENESIS';
          break;
        } else if (record.type == 'MINT') {
          type = 'MINT';
          continue;
        }
        // Add the output to the output total
        const outputValue = U64.fromBE(record.value);
        outputTotal.iadd(outputValue);
      }
      if (type != 'GENESIS') {
        let parentIndex = -1;

        for (let j = 0; j < toAdd[key].prevouts.length; j++) {
          const prevoutHash = toAdd[key].prevouts[j].hash;
          const prevoutHashStr = prevoutHash.toString('hex');
          const prevoutIndex = toAdd[key].prevouts[j].index;

          // If token type 2 MINT, check to see if this is a valid vault baton input
          if (type === 'MINT' && version === 2) {
            const isVaultBaton = await this.isVaultInput(
              toAdd[key].records[0].tokenId,
              prevoutHash,
              prevoutIndex
            );
            if (isVaultBaton)
              foundMintBaton = true;
          }

          // First check to see if it is chained from a tx in toAdd
          parentIndex = toAddKeys.indexOf(prevoutHashStr);
          if (parentIndex > -1) {
            const parentKey = toAddKeys[parentIndex];
            const parent = toAdd[parentKey];

            // Is chained TX already processed...
            if (parent) {
              if (!parent.isProcessed)
                break;

              parentIndex = -1;
              // If tx is valid, add the amount to inputValue
              if(parent.isValid) {
                const inputRecord = parent.records.find(r => {
                  return r.vout == prevoutIndex 
                    && Buffer.compare(r.hash, prevoutHash) === 0
                    && Buffer.compare(r.tokenId, toAdd[key].records[0].tokenId) === 0
                    && r.version === toAdd[key].records[0].version; 
                });

                if (inputRecord) {
                  if (type == 'MINT' && inputRecord.type == 'BATON') {
                    foundMintBaton = true;
                  } else {
                    const inputValue = U64.fromBE(inputRecord.getValueUInt64BE());
                    inputTotal.iadd(inputValue);
                  }
                }
                continue;
              }
            }
          }
          // Then check to see if it is in the db. If it is add value and continue;
          // If Mint Baton is found then change foundMintBaton to true;
          const hashIndex =  await this.db.get(layout.i.encode(prevoutHash));
          if (hashIndex) {
            const hashIndexInt = uInt32BEToInt(hashIndex)
            const prevoutDb = await this.db.get(layout.s.encode(hashIndexInt, prevoutIndex));
            if (prevoutDb) {
              const inputRecord = SLP.SlpCoinRecord().fromDbData(prevoutDb);
              const tokenHashIndexInt = uInt32BEToInt(inputRecord.tokenIndex);
              const tokenDbValue = await this.db.get(layout.S.encode(tokenHashIndexInt));
              // Patch (under what conditions would this return null?)
              if (!tokenDbValue)
                continue;
              const tokenRecord = SLP.TokenRecord().fromDbData(tokenDbValue);
              // Check that tokenId and version match for coin to add
              if (Buffer.compare(tokenRecord.tokenId, toAdd[key].records[0].tokenId) !== 0
                || tokenRecord.version !== toAdd[key].records[0].version) {
                  continue;
              }

              if (type == 'MINT' && inputRecord.type == 'BATON') {
                foundMintBaton = true;
              } else {
                const inputValue = U64.fromBE(inputRecord.value);
                inputTotal.iadd(inputValue);
              }
              continue;
            }
          }
          
        }
        // If there is still an unprocessed parent, go process it.
        if (parentIndex > -1) {
          i = parentIndex - 1;
          continue;
        }
        // Compare input with output amounts
        toAdd[key].isValid = (type === 'SEND' && inputTotal.gte(outputTotal)) || foundMintBaton;
      }
      toAdd[key].isProcessed = true;

      // Add Records to DB
      if (toAdd[key].isValid) {
        for (let j = 0; j < toAdd[key].records.length; j++) {
          const record = toAdd[key].records[j];

          // Add the token hash (reverse of tokenId) if it is not added yet
          const tokenHash = Buffer.from(record.tokenId).reverse();
          const tokenHashHex = tokenHash.toString('hex')
          // Get hash Index (from current queue, db, or create new by incrementing last)
          const tokenHashIndex = hashIndexes[tokenHashHex] 
            || await this.getTransactionHashIndex(tokenHash, brecord);

          const tokenHashIndexInt = uInt32BEToInt(tokenHashIndex);
          // If this is an unused index, add it to queue and update brecord.last
          hashIndexes[tokenHashHex] = tokenHashIndex;
          if (tokenHashIndexInt > uInt32BEToInt(brecord.last)) {
            brecord.last = tokenHashIndex;
          }

          // Handle SLP COIN RECORD
          if (record.decimals == undefined) {
            const recordHashHex = record.hash.toString('hex');
            const recordHashIndex = hashIndexes[recordHashHex] 
            || await this.getTransactionHashIndex(record.hash, brecord);

            const recordHashIndexInt = uInt32BEToInt(recordHashIndex);
            // If this is an unused index, add it to queue and update brecord.last
            hashIndexes[recordHashHex] = recordHashIndex;
            if (recordHashIndexInt > uInt32BEToInt(brecord.last)) {
              brecord.last = recordHashIndex;
            }
            record.tokenIndex = tokenHashIndex;
            const recordDbData = record.toDbData();
            this.put(layout.s.encode(recordHashIndexInt, record.vout), recordDbData);
          } else {
          // Handle TOKEN RECORD
            const recordDbData = record.toDbData();
            this.put(layout.S.encode(tokenHashIndexInt), recordDbData);
          }
        }
      }
      i = -1;
      continue;
    }

    // Put Hash Indexes
    const hashKeys = Object.keys(hashIndexes);
    for (let i = 0; i < hashKeys.length; i++) {
      const key = hashKeys[i]
      const keyBuf = Buffer.from(key, 'hex');
      await this.db.put(layout.i.encode(keyBuf), hashIndexes[key]);
    }

    // Put Block Record
    this.put(layout.b.encode(meta.height), brecord.toRaw());
  }

  /**
   * Remove SLP data from index.
   * @private
   * @param {BlockMeta} meta
   * @param {Block} block
   * @param {CoinView} view
   */

  async unindexBlock(meta, block, view) {
    const recordsArray = [];
    const hashArray = [];
    // Iterate through transactions and build records
    for (let i = 0; i < block.txs.length; i++) {
      const tx = block.txs[i];
      const hash = tx.hash()
      const hashIndexExists = await this.db.has(layout.i.encode(hash));
      // If there is no hash index, then this was an invalid SLP tx
      if (!hashIndexExists)
          continue;
      const hashIndex = await this.db.get(layout.i.encode(hash));
      const hashIndexInt = uInt32BEToInt(hashIndex);
      hashArray.push(hash)
      const { records } = this.buildSlpRecords(tx)
      // Iterate through records and delete if they exist
      for (let j = 0; j < records.length; j++) {
        const record = records[j]
        // Handle SLP RECORD
        if (record.decimals == undefined) {
          this.del(layout.s.encode(hashIndexInt, record.vout));
        } else {
        // Handle TOKEN RECORD
          this.del(layout.S.encode(hashIndexInt));
        }
      }
    }

    // Delete Hash Index records
    for (let i = 0; i < hashArray.length; i++) {
      await this.db.del(layout.i.encode(hashArray[i]))
    }
    
    // Delete the block record
    this.del(layout.b.encode(meta.height));
  }

  /**
   * Get last transaction hash index used in the most recently indexed block
   * @param {TX} tx height of current block being indexed
   * @returns {
   * type: 'GENESIS' | 'MINT' | 'BATON' | 'SEND' | undefined
   * records: (TokenRecord | SlpCoinRecord)[]
   * } - Returns object with type and array of records or empty array
   */

  buildSlpRecords(tx) {
    let type;
    let records = [];
    for (let j = 0; j < tx.outputs.length; j++) {
      const output = tx.outputs[j];
      if (output.getType() == 'nulldata') {
        // Do validation
        const slpScript = SLP.fromScript(output.script)
        if (slpScript.isValidSlp()) {
          // Get Type
          type = slpScript.getType();
          if (type == 'GENESIS') {
            // Handle Genesis
            if (j != 0)
              break;
            // Write these records. No need to verify
            records = slpScript.getRecords(Buffer.from(tx.txid(), 'hex'));
            continue;
          } else {
            if (type == 'MINT') {
              // Handle Mint
              if (j != 0)
                break;
              records = slpScript.getRecords(Buffer.from(tx.txid(), 'hex'));
              continue;
            } else if (type == 'SEND') {
              if (j == 0) {
                records = slpScript.getRecords(Buffer.from(tx.txid(), 'hex'));
              } else {
                records = slpScript.getSendRecords(Buffer.from(tx.txid(), 'hex'), true);
              }
            }
          }
        }
      }
    }
    // Return object with type and array of records or empty array
    return { type, records };
  }

  /**
   * Get last transaction hash index used in the most recently indexed block
   * @param {Number} currentHeight height of current block being indexed
   * @returns {Promise} - Returns UInt32 buffer representing last hash index
   */

  async getLastHashIndex(height) {
    const prevHeight = height && height > 0 ? height - 1 : 0;
    const prevBlockDb = await this.db.get(layout.b.encode(prevHeight));
    if (!prevBlockDb)
      return Buffer.alloc(4, 0x00);

    const prevBlockRecord = BlockRecord.fromRaw(prevBlockDb);
    return prevBlockRecord.last
  }

  /**
   * Get transaction hash index or create if it doesn't exist
   * @param {Hash} hash
   * @param {BlockRecord} brecord block record fo block being indexed
   * @returns {Promise} - Returns UInt32 buffer representing hash index
   */

  async getTransactionHashIndex(hash, brecord) {
    // Check if hash index is already in db
    const hashIndex = await this.db.get(layout.i.encode(hash));
    // If exists, return the int. overwrite/replace if out of bounds
    if(hashIndex) {
      if (uInt32BEToInt(hashIndex) <= uInt32BEToInt(brecord.start))
        return hashIndex;
    }
    // If it doesn't exist, increment last used index and return value
    return incrementUInt32BE(brecord.last);
  }

  /**
   * Retrieve token record for a particular transaction hash.
   * @param {Hash} hash The reverse of the token ID
   * @returns {Promise} - Returns {TokenRecord}
   */

  async getTokenRecord(hash) {
    const hashIndex =  await this.db.get(layout.i.encode(hash));
    if (!hashIndex)
      return null;

    const hashIndexInt = uInt32BEToInt(hashIndex);
    const tokenDbData = await this.db.get(layout.S.encode(hashIndexInt));
    if (!tokenDbData)
      return null;

    const tokenRecord = SLP.TokenRecord().fromDbData(tokenDbData);

    return tokenRecord;
    
  }

  /**
   * Retrieve coin records for a particular transaction hash.
   * @param {Hash} hash
   * @param {Number?} index If included will return information about a specific output only
   * @returns {Promise} - Returns {SLPCoinRecord | SLPCoinRecord[]}
   */

  async getSlpCoinRecords(hash, index) {
    const hashIndex =  await this.db.get(layout.i.encode(hash));
    if (!hashIndex) {
      return null;
    }
    const hashIndexInt = uInt32BEToInt(hashIndex);

    const processDbData = async (key, value) => {
      if (!value) {
        return value;
      }
      const record = SLP.SlpCoinRecord().fromDbData(value);
      [record.hashIndex, record.vout] = layout.s.decode(key);
      const tokenHashIndexInt = uInt32BEToInt(record.tokenIndex);
      const tokenDbValue = await this.db.get(layout.S.encode(tokenHashIndexInt));
      // Handle unsupported SLP token types (ie. NFT1) - TODO: add support
      if (!tokenDbValue) {
        return !tokenDbValue;
      }
      const tokenRecord = SLP.TokenRecord().fromDbData(tokenDbValue);
      record.tokenId = tokenRecord.tokenId;
      return record;
    }

    if (index) {
      const key = layout.s.encode(hashIndexInt, index);
      const indexDbData = await this.db.get(key)
      return await processDbData(key, indexDbData);
    }

    const indexData = await this.db.range({
      gte: layout.s.min(hashIndexInt),
      lte: layout.s.max(hashIndexInt),
      parse: processDbData
    });
    
    return await Promise.all(indexData);
  }

  /**
   * @param {Hash} hash
   * @returns {Promise} - Returns Boolean.
   */

  async iSlpTX(hash) {
    return this.db.has(layout.i.encode(hash));
  }

  /**
   * Checks to see if an input is coming from the mint vault (Token Type 2)
   * @param {Buffer} tokenId
   * @param {Hash} txHash input hash
   * @param {Number} txIndex input index
   * @returns {Promise} - Returns Boolean.
   */

  async isVaultInput(tokenId, txHash, txIndex) {
    // CLone the tokenId buffer before reversing it
    const tokenIdHash = Buffer.from(tokenId.toString('hex'), 'hex').reverse();
    // Get token record
    const tokenRecord = await this.getTokenRecord(tokenIdHash);
    // Get transaction
    const tx = await this.getTX(txHash);
    // Get output hash to check
    const output = tx.outputs[txIndex];
    // Check to be sure this is a P2SH address
    if (output.getType() === 'scripthash') {
      const vaultHash = output.getHash();
      // Compare vault scripthash to scripthash of output
      const compareHashes = Buffer.compare(tokenRecord.vaultScriptHash, vaultHash);
      if (compareHashes === 0)
        return true;
    }

    return false;
  }

  /**
   * Get a transaction with metadata.
   * @param {Hash} hash
   * @returns {Promise} - Returns {@link TXMeta}.
   */

    async getMeta(hash) {
      const raw = await this.txdb.get(layout.t.encode(hash));
      if (!raw)
        return null;
  
      const record = TxRecord.fromRaw(raw);
      const {height, index, offset, length} = record;
  
      const braw = await this.txdb.get(layout.b.encode(height));
      if (!braw)
        return null;
  
      const brecord = TXBlockRecord.fromRaw(braw);
      const {block, time} = brecord;
  
      const data = await this.blocks.read(block, offset, length);
  
      const tx = TX.fromRaw(data);
  
      const meta = TXMeta.fromTX(tx);
      meta.height = height;
      meta.block = block;
      meta.time = time;
      meta.index = index;
  
      return meta;
    }
  
    /**
     * Retrieve a transaction.
     * @param {Hash} hash
     * @returns {Promise} - Returns {@link TX}.
     */
  
    async getTX(hash) {
      const meta = await this.getMeta(hash);
  
      if (!meta)
        return null;
  
      return meta.tx;
    }

}

module.exports = SLPIndexer;
