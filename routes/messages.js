var express = require("express");
var router = express.Router();
let { checkLogin } = require("../utils/authHandler.js");
let messageModel = require("../schemas/messages");
let multer = require("multer");
let path = require("path");

// multer storage cho file bất kỳ
let storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    let ext = path.extname(file.originalname);
    cb(
      null,
      Date.now() + "-" + Math.round(Math.random() * 1_000_000_000) + ext,
    );
  },
});
let upload = multer({ storage });

// GET /:userID - lấy toàn bộ tin nhắn giữa user hiện tại và userID
router.get("/:userID", checkLogin, async function (req, res) {
  try {
    let currentUser = req.userId;
    let otherUser = req.params.userID;

    let messages = await messageModel
      .find({
        $or: [
          { from: currentUser, to: otherUser },
          { from: otherUser, to: currentUser },
        ],
      })
      .populate("from", "username avatarUrl")
      .populate("to", "username avatarUrl")
      .sort({ createdAt: 1 });

    res.send(messages);
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

// POST /:userID - gửi tin nhắn (text hoặc file) đến userID
router.post(
  "/:userID",
  checkLogin,
  upload.single("file"),
  async function (req, res) {
    try {
      let currentUser = req.userId;
      let toUser = req.params.userID;

      let messageContent;
      if (req.file) {
        messageContent = {
          type: "file",
          text: req.file.path,
        };
      } else {
        if (!req.body.text) {
          return res
            .status(400)
            .send({ message: "text là bắt buộc khi không gửi file" });
        }
        messageContent = {
          type: "text",
          text: req.body.text,
        };
      }

      let newMessage = new messageModel({
        from: currentUser,
        to: toUser,
        messageContent,
      });
      await newMessage.save();
      await newMessage.populate("from", "username avatarUrl");
      await newMessage.populate("to", "username avatarUrl");

      res.status(201).send(newMessage);
    } catch (err) {
      res.status(400).send({ message: err.message });
    }
  },
);

// GET / - lấy tin nhắn cuối cùng của mỗi cuộc trò chuyện liên quan đến user hiện tại
router.get("/", checkLogin, async function (req, res) {
  try {
    let currentUser = req.userId;

    // Aggregate: nhóm theo cặp (from, to), lấy message mới nhất
    let lastMessages = await messageModel.aggregate([
      {
        $match: {
          $or: [
            { from: new (require("mongoose").Types.ObjectId)(currentUser) },
            { to: new (require("mongoose").Types.ObjectId)(currentUser) },
          ],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: {
            $cond: [
              { $lt: ["$from", "$to"] },
              { u1: "$from", u2: "$to" },
              { u1: "$to", u2: "$from" },
            ],
          },
          lastMessage: { $first: "$$ROOT" },
        },
      },
      { $replaceRoot: { newRoot: "$lastMessage" } },
      { $sort: { createdAt: -1 } },
    ]);

    // Populate from/to
    let populated = await messageModel.populate(lastMessages, [
      { path: "from", select: "username avatarUrl" },
      { path: "to", select: "username avatarUrl" },
    ]);

    res.send(populated);
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

module.exports = router;
