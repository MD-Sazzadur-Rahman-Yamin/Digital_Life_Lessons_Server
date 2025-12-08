require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const stripe = require("stripe")(process.env.stripe_secret);

const app = express();
const port = process.env.PORT || 3333;

// middlewares
app.use(cors());
app.use(express.json());

// MongoDB connection string
const uri = `mongodb+srv://${process.env.mongodb_user}:${process.env.mongodb_pass}@cluster0.zzj1wzu.mongodb.net/?retryWrites=true&w=majority`;

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
    //Database
    const db = client.db("Digital_Life_Lessons_DB");
    //collections
    const users_coll = db.collection("users");
    const payments_coll = db.collection("payments");

    //users APIs
    app.post("/users/sync", async (req, res) => {
      //add user
      try {
        const user = req.body;
        user.role = "user";
        user.createdAt = new Date();
        user.isPremium = false;

        const email = user.email;
        const isUserExist = await users_coll.findOne({ email });
        if (isUserExist) {
          return res.send({ message: "User Exist" });
        }
        const result = await users_coll.insertOne(user);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    //payments api
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
            metadata: paymentInfo.metadata,
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

    app.patch("/payments/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        console.log(sessionId);
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        console.log(session);

        //stop duplicate entry
        const query = { transactionId: session.payment_intent };
        const paymentExist = await payments_coll.findOne(query);
        if (paymentExist) {
          return res.send(paymentExist);
        }
        //payment data
        const payment = {
          userEmail: session.customer_email,
          stripeSessionId: sessionId,
          currency: session.currency,
          amount: session.amount_total / 100,
          status: session.payment_status,
          createdAt: new Date(),
          transactionId: session.payment_intent,
        };

        //update user isPremium status
        if (session.payment_status === "paid") {
          const query = { email: session.customer_email };
          const update = {
            $set: {
              isPremium: true,
            },
          };
          const result = await users_coll.updateOne(query, update);

          //add payment data in db
          const paymentResult = await payments_coll.insertOne(payment);

          res.send({
            message: "Payment successful",
            transactionId: payment.transactionId,
            userModifiedCount: userResult.modifiedCount,
            paymentInsertedId: paymentResult.insertedId,
          });
        }
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
run();

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
