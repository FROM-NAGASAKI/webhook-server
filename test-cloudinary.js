// Cloudinaryへの直接アップロードをテストするスクリプト
// 使い方:
//   1. このファイルを C:\webhook-server\test-cloudinary.js として保存
//   2. 同じフォルダに test.png という小さい画像ファイルを置く
//   3. 下の api_key と api_secret を、現在Railwayに設定している値に書き換える
//   4. ターミナルで実行: node test-cloudinary.js
//   5. テストが終わったらこのファイルと test.png は削除してOK（本番コードとは無関係）

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: 'ip0a4dej',
  api_key: '869394117897547',
  api_secret: '6SEaSzrTo_Jp4zNz2giVMUmDRls'
});

cloudinary.uploader.upload('./test.png', { resource_type: 'auto' })
  .then(result => {
    console.log('成功:', result.secure_url);
  })
  .catch(err => {
    console.error('失敗:', err.message);
    console.error('詳細:', err);
  });
