// Cloudinary関連の共通処理（アップロード・削除）
// contacts.js / admin.js / broadcast.js から共通で利用する

const cloudinary = require('cloudinary').v2;
const sharp = require('sharp');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// スマホ由来の非標準な画像ファイル（壊れたPNG等）をCloudinaryが拒否することがあるため、
// 画像の場合は一度sharpで標準的な形式に再エンコードしてからアップロードする
async function normalizeImageBuffer(buffer, mimetype) {
  if (!mimetype || !mimetype.startsWith('image/')) return buffer; // 画像以外はそのまま
  try {
    if (mimetype === 'image/png') {
      return await sharp(buffer, { failOn: 'none' }).png().toBuffer();
    }
    if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
      return await sharp(buffer, { failOn: 'none' }).jpeg().toBuffer();
    }
    return await sharp(buffer, { failOn: 'none' }).jpeg().toBuffer();
  } catch (e) {
    console.error('画像の再エンコードに失敗、元のバッファのまま続行:', e.message);
    return buffer;
  }
}

// バッファをCloudinaryにアップロードする。
// 戻り値には、後で削除する際に必要な public_id と resource_type も含める。
async function uploadToCloudinary(buffer, originalname, mimetype) {
  const normalizedBuffer = await normalizeImageBuffer(buffer, mimetype);
  console.log('uploadToCloudinary詳細: size=' + normalizedBuffer.length + ' bytes (元: ' + buffer.length + ' bytes), mimetype=' + mimetype + ', name=' + originalname);
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'auto', // 画像・PDF・Word・Excelなどをまとめて扱う
        folder: 'from-nagasaki-attachments'
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinaryエラー詳細:', JSON.stringify(error));
          return reject(error);
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          resourceType: result.resource_type // 'image' | 'video' | 'raw'
        });
      }
    );
    stream.end(normalizedBuffer);
  });
}

// Cloudinary上の資産を削除する（自動クリーンアップ用）
async function deleteFromCloudinary(publicId, resourceType) {
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType || 'image' });
}

module.exports = { cloudinary, uploadToCloudinary, deleteFromCloudinary };
