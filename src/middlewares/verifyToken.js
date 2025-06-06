import jwt from "jsonwebtoken";

const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Bearer token borligini tekshiramiz
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token yo'q yoki noto‘g‘ri formatda" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // foydalanuvchi ma'lumotlarini requestga qo'shamiz
    next();
  } catch (err) {
    res.status(401).json({ error: "Token noto‘g‘ri yoki muddati tugagan" });
  }
};

export default verifyToken;
