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
const varifyFBToken = async (req, res, next) => {
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

    app.get("/users/me/:uid", varifyFBToken, verifyUid, async (req, res) => {
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

    app.patch("/users/update/:id", varifyFBToken, async (req, res) => {
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
    app.post("/lessons", varifyFBToken, async (req, res) => {
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

    app.get("/lessons/:id", varifyFBToken, async (req, res) => {
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
      varifyFBToken,
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

    app.patch("/lessons/:id", varifyFBToken, async (req, res) => {
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

    app.delete("/lessons/:id", varifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;

        const query = { _id: new ObjectId(id) };
        const result = await lessons_coll.deleteOne(query);

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.post("/lessons/:id/report", varifyFBToken, async (req, res) => {
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

    // COMMENTS
    app.post("/comments", async (req, res) => {
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
    app.get("/comments/:lessonId", async (req, res) => {
      try {
        const lessonId = req.params.lessonId;
        const query = { lessonId: lessonId };
        const lesson = await comments_coll.find(query).toArray();
        res.send(lesson);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

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

    app.patch("/payments/payment-success", varifyFBToken, async (req, res) => {
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
