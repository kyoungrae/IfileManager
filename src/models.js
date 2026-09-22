import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const schemaOptions = { timestamps: true, versionKey: false };

export const User = model('User', new Schema({
  usernameKey: { type: String, required: true, unique: true, index: true },
  usernameEncrypted: { type: String, required: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
  disabled: { type: Boolean, default: false }
}, schemaOptions));

export const ManagedFolder = model('ManagedFolder', new Schema({
  pathKey: { type: String, required: true, unique: true, index: true },
  parentPathKey: { type: String, required: true, index: true },
  nameEncrypted: { type: String, required: true },
  pathEncrypted: { type: String, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, schemaOptions));

export const ManagedFile = model('ManagedFile', new Schema({
  fileId: { type: String, required: true, unique: true, index: true },
  folderPathKey: { type: String, required: true, index: true },
  storageId: { type: String, required: true, unique: true },
  nameEncrypted: { type: String, required: true },
  mimeEncrypted: { type: String, required: true },
  size: { type: Number, required: true, min: 0 },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, schemaOptions));

export const AuditLog = model('AuditLog', new Schema({
  actor: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action: { type: String, required: true, index: true },
  targetEncrypted: { type: String, required: true },
  detailsEncrypted: { type: String }
}, schemaOptions));
