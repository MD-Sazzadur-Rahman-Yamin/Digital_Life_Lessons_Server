require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.stripe_secret);

//* firebase admin
const admin = require("firebase-admin");
const serviceAccount = require("./digital-life-lessons-sazztech-firebase-adminsdk.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
const port = process.env.PORT || 3333;

//* middlewares
app.use(cors());
app.use(express.json());
const verifyFBToken = async (req, res, next) => {
  const token = req.headers?.authorization;
  if (!token) {
    return res.status(401).send({ message: "Unauthorize access" });
  }
  try {
    const idtoken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idtoken);
    req.decoded_uid = decoded.uid;
    next();
  } catch {
    return res.status(401).send({ message: "Unauthorize access" });
  }
};
const verifyUid = (req, res, next) => {
  try {
    const decodedUid = req.decoded_uid;
    const paramsUid = req.params.uid;

    if (decodedUid !== paramsUid) {
      return res.status(403).send({ message: "Forbidden access" });
    }

    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
};

//* MongoDB connection string
const uri = `mongodb+srv://${process.env.mongodb_user}:${process.env.mongodb_pass}@cluster0.zzj1wzu.mongodb.net/Digital_Life_Lessons_DB?retryWrites=true&w=majority`;
// const uri = `mongodb+srv://${process.env.mongodb_user}:${process.env.mongodb_pass}@cluster0.zzj1wzu.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    //* Database
    const db = client.db("Digital_Life_Lessons_DB");
    //* collections
    const users_coll = db.collection("users");
    const payments_coll = db.collection("payments");
    const lessons_coll = db.collection("lessons");
    const comments_coll = db.collection("comments");
    const lessonReports_coll = db.collection("lessonReports");
    const favorites_coll = db.collection("favorites");

    // * middleware with database access
    const verifyAdmin = async (req, res, next) => {
      //must be used after varifyFBToken middilware
      const uid = req.decoded_uid;
      const query = { firebaseUid: uid };
      const user = await users_coll.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    //* users APIs
    app.post("/users/sync", async (req, res) => {
      //add user
      try {
        const user = req.body;
        const userData = {
          firebaseUid: user.firebaseUid,
          name: user.name,
          email: user.email,
          photoURL: user.photoURL,
          role: "user",
          isPremium: false,
          createdAt: user.createdAt,
        };

        const uid = user.firebaseUid;
        const isUserExist = await users_coll.findOne({
          firebaseUid: uid,
        });

        if (isUserExist) {
          return res.send({ message: "User Exist" });
        }
        const result = await users_coll.insertOne(userData);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/user/:uid", async (req, res) => {
      try {
        const uid = req.params.uid;
        const user = await users_coll.findOne({ firebaseUid: uid });
        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }
        res.send(user);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/users/me/:uid", verifyFBToken, verifyUid, async (req, res) => {
      try {
        const uid = req.params.uid;
        const user = await users_coll.findOne({ firebaseUid: uid });
        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }
        res.send(user);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.patch("/users/update/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        console.log(req.body);
        const query = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            name: req.body.displayName,
            photoURL: req.body.photoURL,
          },
        };
        const result = await users_coll.updateOne(query, updatedDoc);

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // LESSONS
    app.post("/lessons", verifyFBToken, async (req, res) => {
      // add lessons API
      // frontend will sent title, story, category, emotionalTone, visibility, accessLevel,creatorUid, createdAt, updatedAt
      // backend will add likes, likesCount, favoritesCount, isFeatured
      // frontend will sent title, story, category, emotionalTone, visibility, accessLevel,creatorEmail, createdAt, updatedAt

      try {
        const { creatorUid, accessLevel } = req.body;
        const user = await users_coll.findOne({ firebaseUid: creatorUid });
        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }
        // Only block when creating a PREMIUM lesson
        if (accessLevel === "Premium" && user.isPremium === false) {
          return res.status(403).send({
            message: "Upgrade to Premium to create premium lessons",
          });
        }

        const lesson = req.body;
        const lessonData = {
          title: lesson.title,
          story: lesson.story,
          category: lesson.category,
          emotionalTone: lesson.emotionalTone,
          visibility: lesson.visibility,
          accessLevel: lesson.accessLevel,
          creatorUid: lesson.creatorUid,
          createdAt: lesson.createdAt,
          update: lesson.updatedAt,
          likes: [],
          likesCount: 0,
          favoritesCount: 0,
          isFeatured: false,
        };

        const result = await lessons_coll.insertOne(lessonData);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/lessons", async (req, res) => {
      //get all publit lessons
      try {
        const query = { visibility: "Public" };
        const cursor = lessons_coll.find(query);
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/lessons/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const lesson = await lessons_coll.findOne(query);
        res.send(lesson);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get(
      "/lessons/my-lessons/:uid",
      verifyFBToken,
      verifyUid,
      async (req, res) => {
        try {
          const creatorUid = req.params.uid;
          const query = { creatorUid: creatorUid };
          const cursor = lessons_coll.find(query);
          const result = await cursor.toArray();
          res.send(result);
        } catch (error) {
          res.status(500).send({ error: error.message });
        }
      }
    );

    app.patch("/lessons/:id", verifyFBToken, async (req, res) => {
      // update lessons API
      // frontend will sent title, story, category, emotionalTone, visibility, accessLevel, updatedAt
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const dataToUpdate = req.body;
        const updatedDoc = {
          $set: {
            title: dataToUpdate.title,
            story: dataToUpdate.story,
            category: dataToUpdate.category,
            emotionalTone: dataToUpdate.visibility,
            accessLevel: dataToUpdate.accessLevel,
            updatedAt: dataToUpdate.updatedAt,
          },
        };
        const result = await lessons_coll.updateOne(query, updatedDoc);

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.delete("/lessons/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;

        const query = { _id: new ObjectId(id) };
        const result = await lessons_coll.deleteOne(query);

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.patch("/lessons/:id/like", verifyFBToken, async (req, res) => {
      try {
        const lessonId = req.params.id;
        const userUid = req.decoded_uid;

        const lesson = await lessons_coll.findOne({
          _id: new ObjectId(lessonId),
        });

        if (!lesson) {
          return res.status(404).send({ message: "Lesson not found" });
        }

        const hasLiked = lesson.likes.includes(userUid);

        const update = hasLiked
          ? {
              $pull: { likes: userUid },
              $inc: { likesCount: -1 },
            }
          : {
              $addToSet: { likes: userUid },
              $inc: { likesCount: 1 },
            };

        await lessons_coll.updateOne({ _id: new ObjectId(lessonId) }, update);

        res.send({
          success: true,
          isLiked: !hasLiked,
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Toggle favorite for a lesson
    app.patch("/lessons/:id/favorite", verifyFBToken, async (req, res) => {
      try {
        const lessonId = req.params.id;
        const userUid = req.decoded_uid;

        const lessonQuery = { _id: new ObjectId(lessonId) };
        const lesson = await lessons_coll.findOne(lessonQuery);
        if (!lesson)
          return res.status(404).send({ message: "Lesson not found" });

        const favoriteExistsQuery = {
          userUid,
          lessonId: new ObjectId(lessonId),
        };
        // Check if already favorited
        const favoriteExists = await favorites_coll.findOne(
          favoriteExistsQuery
        );

        if (favoriteExists) {
          // যদি আছে → remove favorite
          await favorites_coll.deleteOne({ _id: favoriteExists._id });
          await lessons_coll.updateOne(
            { _id: new ObjectId(lessonId) },
            { $inc: { favoritesCount: -1 } }
          );
          return res.send({ success: true, isFavorite: false });
        } else {
          // যদি না থাকে → add favorite
          await favorites_coll.insertOne({
            userUid,
            lessonId: new ObjectId(lessonId),
            createdAt: new Date(),
          });
          await lessons_coll.updateOne(
            { _id: new ObjectId(lessonId) },
            { $inc: { favoritesCount: 1 } }
          );
          return res.send({ success: true, isFavorite: true });
        }
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: error.message });
      }
    });

    app.get("/favorites/check", verifyFBToken, async (req, res) => {
      try {
        const lessonId = req.query.lessonId; // query থেকে lessonId পাওয়া
        const userUid = req.decoded_uid; // middleware থেকে current user UID

        const favorite = await db.collection("favorites").findOne({
          userUid,
          lessonId: new ObjectId(lessonId),
        });

        if (favorite) {
          res.send({ isFavorite: true });
        } else {
          res.send({ isFavorite: false });
        }
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: error.message });
      }
    });

    app.post("/lessons/:id/report", verifyFBToken, async (req, res) => {
      // Add report
      try {
        const lessonId = req.params.id;
        const body = req.body;

        const reportData = {
          lessonId: lessonId,
          reporterUid: body.reporterUid,
          reason: body.reason,
          timestamp: body.timestamp,
        };

        const result = await lessonReports_coll.insertOne(reportData);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.get("/lessons/recommended/:id", verifyFBToken, async (req, res) => {
      try {
        const lessonId = req.params.id;
        const lessonQuery = { _id: new ObjectId(lessonId) };
        const lesson = await lessons_coll.findOne(lessonQuery);

        const recommendedQuery = { category: lesson.category };
        const recommendedCursor = lessons_coll.find(recommendedQuery).limit(6);
        const recommendedResult = await recommendedCursor.toArray();
        res.send(recommendedResult);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // FAVORITES
    app.get("/favorites", verifyFBToken, async (req, res) => {
      // api to get login users favorite lessons
      try {
        const uid = req.decoded_uid;
        const query = { userUid: uid };
        const cursor = favorites_coll.find(query);
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.delete("/favorites/:id", verifyFBToken, async (req, res) => {
      // api to delete login users favorite lessons
      try {
        const id = req.params.id;

        const query = { _id: new ObjectId(id) };
        const result = await favorites_coll.deleteOne(query);

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // COMMENTS
    app.post("/comments", verifyFBToken, async (req, res) => {
      try {
        const body = req.body;
        const commentData = {
          lessonId: body.lessonId,
          userUid: body.userUid,
          userName: body.userName,
          commentText: body.commentText,
          createdAt: body.createdAt,
        };

        const result = await comments_coll.insertOne(commentData);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });
    app.get("/comments/:lessonId", verifyFBToken, async (req, res) => {
      try {
        const lessonId = req.params.lessonId;
        const query = { lessonId: lessonId };
        const lesson = await comments_coll.find(query).toArray();
        res.send(lesson);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // Admin

    app.get(
      "/admin/manage-users",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        // Only admin can access this route
        try {
          const users = await users_coll.find().toArray();
          res.send(users);
        } catch (error) {
          res.status(500).send({ error: error.message });
        }
      }
    );

    //* payments api
    //stripe
    app.post(
      "/payments/create-checkout-session/digital-life-lessons-premium",
      async (req, res) => {
        try {
          // body must contain user customer_email, metadata(object)(it can be anything)
          const paymentInfo = req.body;
          const session = await stripe.checkout.sessions.create({
            line_items: [
              {
                price_data: {
                  currency: "BDT",
                  unit_amount: 150000,
                  product_data: {
                    name: "Digital Life Lessons Premium",
                  },
                },
                quantity: 1,
              },
            ],
            // metadata: paymentInfo.metadata,
            metadata: {
              customer_name: paymentInfo.metadata.customer_name,
              firebaseUid: paymentInfo.metadata.firebaseUid,
            },
            customer_email: paymentInfo.customer_email,
            mode: "payment",
            success_url: `${process.env.client_domain}/upgrade-successful?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.client_domain}/upgrade-failed`,
          });
          res.send({ url: session.url });
        } catch (error) {
          res.status(500).send({ error: error.message });
        }
      }
    );

    app.patch("/payments/payment-success", verifyFBToken, async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // Stop duplicate entry
        const existQuery = { transactionId: session.payment_intent };
        const existingPayment = await payments_coll.findOne(existQuery);

        if (existingPayment) {
          return res.send({
            message: "Payment already recorded",
            duplicate: true,
            payment: existingPayment,
            transactionId: session.payment_intent,
          });
        }

        // Build payment data
        const payment = {
          firebaseUid: session.metadata.firebaseUid,
          userEmail: session.customer_email,
          stripeSessionId: sessionId,
          currency: session.currency,
          amount: session.amount_total / 100,
          status: session.payment_status,
          createdAt: new Date(),
          transactionId: session.payment_intent, // unique identifier
        };

        // Update user premium status
        if (session.payment_status === "paid") {
          const userQuery = { firebaseUid: session.metadata.firebaseUid };
          const update = { $set: { isPremium: true } };

          const userResult = await users_coll.updateOne(userQuery, update);

          // Insert payment in DB
          const paymentResult = await payments_coll.insertOne(payment);

          return res.send({
            message: "Payment successful",
            transactionId: payment.transactionId,
            userModifiedCount: userResult.modifiedCount,
            paymentInsertedId: paymentResult.insertedId,
          });
        }

        // If payment not paid
        res.send({
          message: "Payment is not marked as paid",
          status: session.payment_status,
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });
    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB!");
  } catch (error) {
    console.log("MongoDB Error:", error);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
