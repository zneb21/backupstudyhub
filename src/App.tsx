import { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import type { Auth, User } from 'firebase/auth';
// Suppress unused warnings for orderBy and limit, as they are imported for context but not used in current queries
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, serverTimestamp, where, getDocs, orderBy, limit } from 'firebase/firestore';
import type { Firestore, QueryDocumentSnapshot, Timestamp } from 'firebase/firestore';

// Global variables provided by the environment
// For local development, REPLACE THESE WITH YOUR ACTUAL FIREBASE CONFIGURATION.
// You can find these details in your Firebase Console under Project settings -> "Your apps"
const appId = 'study-hub-local-dev'; // A unique ID for your local app's Firestore paths (e.g., 'your-app-name-dev')
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY", // <--- PASTE YOUR API KEY HERE
  authDomain: "YOUR_FIREBASE_AUTH_DOMAIN", // <--- PASTE YOUR AUTH DOMAIN HERE
  projectId: "YOUR_FIREBASE_PROJECT_ID",   // <--- PASTE YOUR PROJECT ID HERE
  storageBucket: "YOUR_FIREBASE_STORAGE_BUCKET", // <--- PASTE YOUR STORAGE BUCKET HERE
  messagingSenderId: "253493180142", // <--- PASTE YOUR SENDER ID HERE
  appId: "1:253493180142:web:5ed525c3def1a90644a5ff" // <--- PASTE YOUR APP ID HERE (this is different from the appId variable above)
  // measurementId: "G-RVXVNFWK93" // Uncomment if you use Google Analytics
};
const initialAuthToken: string | null = null; // Explicitly type initialAuthToken

// Define interfaces for your data structures
interface StudyUser {
  id: string;
  username: string;
}

interface UserSession {
  id: string; // Firestore document ID for the session (made non-optional as we always derive it)
  userId: string;
  username: string;
  loginTime: Timestamp; // Firebase Timestamp type
  isLoggedIn: boolean;
  logoutTime: Timestamp | null;
  currentTime?: Date; // For real-time display, not stored in Firestore
}

interface PaymentDetails {
  username: string;
  duration: string;
  totalPayment: number;
}


function App() {
  const [db, setDb] = useState<Firestore | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [auth, setAuth] = useState<Auth | null>(null); // Suppress 'auth' unused warning
  const [userId, setUserId] = useState<string | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);

  const [allUsers, setAllUsers] = useState<StudyUser[]>([]);
  const [activeSessions, setActiveSessions] = useState<UserSession[]>([]);

  const [newUserName, setNewUserName] = useState<string>('');
  const [userToRemoveId, setUserToRemoveId] = useState<string>('');

  const [showPaymentModal, setShowPaymentModal] = useState<boolean>(false);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails | null>(null);

  const [message, setMessage] = useState<string>('');

  const [showConfirmRemoveAllModal, setShowConfirmRemoveAllModal] = useState<boolean>(false);

  const intervalRefs = useRef<Record<string, number>>({});

  // 1. Initialize Firebase and authenticate
  useEffect(() => {
    let app: FirebaseApp;
    let authInstance: Auth;
    let dbInstance: Firestore;

    try {
      if (firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY" || firebaseConfig.apiKey === "") {
        const errorMessage = "Firebase API Key is missing or invalid. Please replace 'YOUR_FIREBASE_API_KEY' and other Firebase config placeholders with your actual project details from the Firebase Console (Project settings -> Your apps).";
        console.error("Firebase Initialization Error:", errorMessage);
        setMessage(`Error: ${errorMessage}`);
        console.log("Current firebaseConfig:", firebaseConfig);
        return;
      }

      app = initializeApp(firebaseConfig);
      authInstance = getAuth(app);
      dbInstance = getFirestore(app);

      setAuth(authInstance);
      setDb(dbInstance);

      const unsubscribeAuth = onAuthStateChanged(authInstance, async (user: User | null) => {
        if (user) {
          setUserId(user.uid);
          setIsAuthReady(true);
          setMessage(`Admin User ID: ${user.uid}`);
        } else {
          try {
            if (initialAuthToken) {
              await signInWithCustomToken(authInstance, initialAuthToken);
            } else {
              await signInAnonymously(authInstance);
            }
          } catch (error: any) {
            console.error("Firebase Auth Error:", error);
            setMessage(`Authentication failed: ${error.message}`);
          }
        }
      });

      return () => {
        unsubscribeAuth();
        Object.values(intervalRefs.current).forEach(clearInterval);
      };
    } catch (error: any) {
      console.error("Failed to initialize Firebase:", error);
      setMessage(`Firebase initialization failed: ${error.message}`);
    }
  }, []);

  // 2. Listen for 'users' collection changes (registered study hub users)
  useEffect(() => {
    if (!db || !userId || !isAuthReady) return;

    const usersCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/users`);
    const unsubscribeUsers = onSnapshot(usersCollectionRef, (snapshot) => {
      const usersData: StudyUser[] = snapshot.docs.map((doc: QueryDocumentSnapshot) => {
        const data = doc.data();
        return {
          id: doc.id,
          username: data.username,
        } as StudyUser;
      });
      setAllUsers(usersData);
    }, (error: any) => {
      console.error("Error fetching users:", error);
      setMessage(`Error loading users: ${error.message}`);
    });

    return () => unsubscribeUsers();
  }, [db, userId, isAuthReady]);

  // 3. Listen for 'sessions' collection changes (active logins)
  useEffect(() => {
    if (!db || !userId || !isAuthReady) return;

    const sessionsCollectionRef = collection(db, `artifacts/${appId}/public/data/sessions`);
    const q = query(sessionsCollectionRef, where("isLoggedIn", "==", true));

    const unsubscribeSessions = onSnapshot(q, (snapshot) => {
      const sessionsData: UserSession[] = snapshot.docs.map((doc: QueryDocumentSnapshot) => {
        const data = doc.data();
        // Correctly assign 'id' and other properties to avoid overwrite warnings
        const session: UserSession = {
          id: doc.id, // Explicitly use doc.id as the primary ID
          userId: data.userId,
          username: data.username,
          loginTime: data.loginTime,
          isLoggedIn: data.isLoggedIn,
          logoutTime: data.logoutTime,
          // Only include currentTime if it exists in data, otherwise it's fine as optional
          ...(data.currentTime && { currentTime: data.currentTime })
        };
        return session;
      });
      setActiveSessions(sessionsData);
    }, (error: any) => {
      console.error("Error fetching active sessions:", error);
      setMessage(`Error loading active sessions: ${error.message}`);
    });

    return () => unsubscribeSessions();
  }, [db, userId, isAuthReady]);

  // 4. Real-time duration update for active sessions
  useEffect(() => {
    Object.values(intervalRefs.current).forEach((intervalId: number) => clearInterval(intervalId));
    intervalRefs.current = {};

    activeSessions.forEach(session => {
      if (session.loginTime && session.isLoggedIn) {
        const intervalId: number = window.setInterval(() => {
          setActiveSessions(prevSessions =>
            prevSessions.map(s =>
              s.id === session.id ? { ...s, currentTime: new Date() } : s
            )
          );
        }, 1000);
        intervalRefs.current[session.id] = intervalId;
      }
    });

    return () => {
      Object.values(intervalRefs.current).forEach((intervalId: number) => clearInterval(intervalId));
    };
  }, [activeSessions]);


  // Helper to calculate duration and payment
  const calculateDurationAndPayment = (loginTimestamp: Timestamp, logoutTimestampOrCurrentTime: Timestamp | Date) => {
    if (!loginTimestamp || !logoutTimestampOrCurrentTime) {
      return { durationMs: 0, hours: 0, totalPayment: 0 };
    }

    const loginTime = loginTimestamp.toDate();
    const endTime = logoutTimestampOrCurrentTime instanceof Date ? logoutTimestampOrCurrentTime : logoutTimestampOrCurrentTime.toDate();
    const durationMs = endTime.getTime() - loginTime.getTime();
    const durationHoursCalculated = durationMs / (1000 * 60 * 60);
    const totalPayment = Math.ceil(durationHoursCalculated) * 20;

    return { durationMs, hours: durationHoursCalculated, totalPayment };
  };

  const handleAddUser = async () => {
    if (!newUserName.trim() || !db || !userId) {
      setMessage('Please enter a username.');
      return;
    }
    try {
      const usersCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/users`);
      const q = query(usersCollectionRef, where("username", "==", newUserName.trim()));
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        setMessage(`User '${newUserName}' already exists.`);
        return;
      }

      await addDoc(usersCollectionRef, { username: newUserName.trim() });
      setNewUserName('');
      setMessage(`User '${newUserName}' added successfully!`);
    } catch (error: any) {
      console.error("Error adding document: ", error);
      setMessage(`Error adding user: ${error.message}`);
    }
  };

  const handleRemoveUser = async () => {
    if (!userToRemoveId || !db || !userId) {
      setMessage('Please select a user to remove.');
      return;
    }
    try {
      const usersCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/users`);
      await deleteDoc(doc(usersCollectionRef, userToRemoveId));

      const sessionsCollectionRef = collection(db, `artifacts/${appId}/public/data/sessions`);
      const q = query(sessionsCollectionRef, where("userId", "==", userToRemoveId), where("isLoggedIn", "==", true));
      const snapshot = await getDocs(q);
      snapshot.forEach(async (sessionDoc) => {
        await updateDoc(sessionDoc.ref, {
          isLoggedIn: false,
          logoutTime: serverTimestamp()
        });
      });

      setUserToRemoveId('');
      setMessage('User removed successfully!');
    } catch (error: any) {
      console.error("Error removing user: ", error);
      setMessage(`Error removing user: ${error.message}`);
    }
  };

  const handleRemoveAllUsers = async () => {
    if (!db || !userId) {
      setMessage('Database not ready.');
      return;
    }
    setShowConfirmRemoveAllModal(false);

    try {
      const usersCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/users`);
      const usersSnapshot = await getDocs(usersCollectionRef);
      const userDeletionPromises = usersSnapshot.docs.map((d: QueryDocumentSnapshot) => deleteDoc(doc(usersCollectionRef, d.id)));
      await Promise.all(userDeletionPromises);

      const sessionsCollectionRef = collection(db, `artifacts/${appId}/public/data/sessions`);
      const activeSessionsQuery = query(sessionsCollectionRef, where("isLoggedIn", "==", true));
      const activeSessionsSnapshot = await getDocs(activeSessionsQuery);
      const sessionUpdatePromises = activeSessionsSnapshot.docs.map((s: QueryDocumentSnapshot) => updateDoc(doc(sessionsCollectionRef, s.id), {
        isLoggedIn: false,
        logoutTime: serverTimestamp()
      }));
      await Promise.all(sessionUpdatePromises);

      setMessage('All users and active sessions removed successfully!');
    } catch (error: any) {
      console.error("Error removing all users: ", error);
      setMessage(`Error removing all users: ${error.message}`);
    }
  };

  // Modified handleLogin to support continuing a session
  const handleLogin = async (user: StudyUser) => {
    if (!db) return;

    try {
      // 1. Check if user is already logged in (active session)
      const existingActiveSession = activeSessions.find(session => session.userId === user.id && session.isLoggedIn);
      if (existingActiveSession) {
        setMessage(`${user.username} is already logged in.`);
        return;
      }

      const sessionsCollectionRef = collection(db, `artifacts/${appId}/public/data/sessions`);

      // 2. Look for the most recent previously logged-out session for this user
      // IMPORTANT: Firebase orderBy requires an index for 'logoutTime' if used with where clause.
      // For simplicity and to avoid requiring an index, we'll fetch all logged-out sessions
      // for this user and sort them on the client-side.
      const qLoggedOut = query(
        sessionsCollectionRef,
        where("userId", "==", user.id),
        where("isLoggedIn", "==", false)
      );
      const loggedOutSnapshot = await getDocs(qLoggedOut);

      // Sort client-side to find the most recent one (highest logoutTime timestamp)
      const loggedOutSessions: UserSession[] = loggedOutSnapshot.docs
        .map((doc: QueryDocumentSnapshot) => {
          const data = doc.data() as Omit<UserSession, 'id'>; // Use Omit to exclude 'id' from spread
          return { id: doc.id, ...data }; // Explicitly assign 'id' first, then spread data
        })
        .filter(session => session.logoutTime !== null) // Ensure logoutTime exists for sorting
        .sort((a, b) => (b.logoutTime?.toMillis() || 0) - (a.logoutTime?.toMillis() || 0)); // Sort descending

      if (loggedOutSessions.length > 0) {
        // Resume the most recent logged-out session
        const sessionToResume = loggedOutSessions[0];
        const sessionDocRef = doc(db, `artifacts/${appId}/public/data/sessions`, sessionToResume.id);
        await updateDoc(sessionDocRef, {
          isLoggedIn: true,
          logoutTime: null // Clear logout time as session is resumed
        });
        setMessage(`${user.username} session continued.`);
      } else {
        // No logged-out session found, create a new one
        await addDoc(sessionsCollectionRef, {
          userId: user.id,
          username: user.username,
          loginTime: serverTimestamp(), // New login time for a fresh session segment
          isLoggedIn: true,
          logoutTime: null,
        } as UserSession);
        setMessage(`${user.username} logged in.`);
      }
    } catch (error: any) {
      console.error("Error logging in/continuing: ", error);
      setMessage(`Error logging in/continuing ${user.username}: ${error.message}`);
    }
  };

  const handleLogout = async (session: UserSession) => {
    if (!db || !session.id) return;
    try {
      const sessionDocRef = doc(db, `artifacts/${appId}/public/data/sessions`, session.id);
      await updateDoc(sessionDocRef, {
        isLoggedIn: false,
        logoutTime: serverTimestamp()
      });

      const currentLoginTime = session.loginTime;
      const currentLogoutTime = new Date();
      const { durationMs, totalPayment } = calculateDurationAndPayment(currentLoginTime, currentLogoutTime);

      setPaymentDetails({
        username: session.username,
        duration: `${Math.floor(durationMs / (1000 * 60 * 60))}h ${Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60))}m ${Math.floor((durationMs % (1000 * 60)) / 1000)}s`,
        totalPayment: totalPayment,
      });
      setShowPaymentModal(true);
      setMessage(`${session.username} logged out.`);

    } catch (error: any) {
      console.error("Error logging out: ", error);
      setMessage(`Error logging out ${session.username}: ${error.message}`);
    }
  };

  const closePaymentModal = () => {
    setShowPaymentModal(false);
    setPaymentDetails(null);
  };

  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 font-inter">
        <div className="text-xl font-semibold text-gray-700">Loading Study Hub App...</div>
      </div>
    );
  }

  const displayUsers = allUsers.map(user => {
    const activeSession = activeSessions.find(session => session.userId === user.id);
    let currentPayment = 0;
    let currentDurationString = '0h 0m 0s';

    if (activeSession && activeSession.loginTime) {
      const loginDate = activeSession.loginTime.toDate();
      const currentDisplayedTime = activeSession.currentTime || new Date();
      const diffMs = currentDisplayedTime.getTime() - loginDate.getTime();
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
      currentDurationString = `${hours}h ${minutes}m ${seconds}s`;

      const durationHours = diffMs / (1000 * 60 * 60);
      currentPayment = Math.ceil(durationHours) * 20;
    }

    return {
      ...user,
      isLoggedIn: !!activeSession,
      session: activeSession,
      currentDurationString: currentDurationString,
      currentPayment: currentPayment
    };
  });

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 font-inter text-gray-800">
      {/* Sidebar for Admin Controls */}
      <aside className="w-full md:w-1/4 bg-white p-6 shadow-lg rounded-lg m-4 md:mr-0 flex flex-col space-y-6">
        <h2 className="text-3xl font-bold text-indigo-700 mb-6 border-b-2 border-indigo-200 pb-2">Admin Panel</h2>

        <div className="text-sm text-gray-600 mb-4 break-all">
          **Admin ID:** <span className="font-mono bg-gray-100 p-1 rounded text-xs">{userId}</span>
        </div>

        {message && (
          <div className={`p-3 rounded-lg text-sm font-medium ${message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
            {message}
          </div>
        )}

        {/* Add New User Section (distinct block) */}
        <div className="bg-blue-50 p-4 rounded-lg shadow-sm">
          <h3 className="text-xl font-semibold text-blue-700 mb-3">Add New User</h3>
          <input
            type="text"
            placeholder="Enter username"
            value={newUserName}
            onChange={(e) => setNewUserName(e.target.value)}
            className="w-full p-2 border border-blue-300 rounded-md focus:ring-2 focus:ring-blue-400 focus:border-transparent mb-3"
          />
          <button
            onClick={handleAddUser}
            className="w-full bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition duration-200 shadow-md"
          >
            Add User
          </button>
        </div>

        {/* Spacing between blocks */}
        <div className="my-4 border-t border-gray-200"></div>

        {/* Remove User Section (distinct block) */}
        <div className="bg-red-50 p-4 rounded-lg shadow-sm">
          <h3 className="text-xl font-semibold text-red-700 mb-3">Remove User</h3>
          <select
            value={userToRemoveId}
            onChange={(e) => setUserToRemoveId(e.target.value)}
            className="w-full p-2 border border-red-300 rounded-md focus:ring-2 focus:ring-red-400 focus:border-transparent mb-3 bg-white"
          >
            <option value="">Select User to Remove</option>
            {allUsers.map(user => (
              <option key={user.id} value={user.id}>{user.username}</option>
            ))}
          </select>
          <button
            onClick={handleRemoveUser}
            className="w-full bg-red-600 text-white p-2 rounded-md hover:bg-red-700 transition duration-200 shadow-md"
          >
            Remove Selected User
          </button>
        </div>

        {/* Spacing between blocks */}
        <div className="my-4 border-t border-gray-200"></div>

        {/* Remove All Users Section (distinct block) */}
        <div className="bg-red-50 p-4 rounded-lg shadow-sm">
          <h3 className="text-xl font-semibold text-red-700 mb-3">Remove All Users</h3>
          <button
            onClick={() => setShowConfirmRemoveAllModal(true)}
            className="w-full bg-red-700 text-white p-2 rounded-md hover:bg-red-800 transition duration-200 shadow-md"
          >
            Remove All Users
          </button>
        </div>
      </aside>

      {/* Main Content Area: User Login/Logout Status */}
      <main className="flex-1 p-6 md:ml-4 m-4 bg-white shadow-lg rounded-lg">
        <h1 className="text-4xl font-extrabold text-indigo-800 mb-8 border-b-2 border-indigo-300 pb-3">
          Study Hub User Log
        </h1>

        {displayUsers.length === 0 ? (
          <p className="text-gray-500 text-lg text-center mt-10">No users registered yet. Add a user from the Admin Panel.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"> {/* Responsive grid for user cards */}
            {displayUsers.map(user => (
              <div key={user.id} className="bg-gray-50 p-6 rounded-xl shadow-md border border-gray-200 flex flex-col items-center">
                <h3 className="text-2xl font-bold text-gray-900 mb-4">{user.username}</h3>
                {user.isLoggedIn ? (
                  <div className="w-full text-center">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-green-800 mb-3">
                      <span className="w-2 h-2 mr-2 bg-green-500 rounded-full animate-pulse"></span>
                      Logged In
                    </span>
                    <p className="text-sm text-gray-600">
                      Login Time: {user.session?.loginTime ? new Date(user.session.loginTime.seconds * 1000).toLocaleTimeString() : 'N/A'}
                    </p>
                    <p className="text-sm text-gray-600 mb-2">
                      Duration: {user.currentDurationString}
                    </p>
                    <p className="text-lg font-bold text-green-700 mb-4">
                      Current Amount: ₱{user.currentPayment}
                    </p>
                    <button
                      onClick={() => user.session && handleLogout(user.session)}
                      className="w-full bg-orange-500 text-white p-3 rounded-lg hover:bg-orange-600 transition duration-200 shadow-lg text-lg font-semibold"
                    >
                      Logout
                    </button>
                  </div>
                ) : (
                  <div className="w-full text-center">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 text-gray-800 mb-3">
                      Logged Out
                    </span>
                    <p className="text-sm text-gray-600 mb-4">
                      Last Logout: {user.session?.logoutTime ? new Date(user.session.logoutTime.seconds * 1000).toLocaleTimeString() : 'N/A'}
                    </p>
                    <div className="flex flex-col space-y-2"> {/* Use flexbox for buttons */}
                      <button
                        onClick={() => handleLogin(user)}
                        className="w-full bg-green-600 text-white p-3 rounded-lg hover:bg-green-700 transition duration-200 shadow-lg text-lg font-semibold"
                      >
                        Login
                      </button>
                      <button
                        onClick={() => handleLogin(user)} // "Continue" now attempts to resume
                        className="w-full bg-indigo-500 text-white p-3 rounded-lg hover:bg-indigo-600 transition duration-200 shadow-lg text-lg font-semibold"
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Payment Modal */}
      {showPaymentModal && paymentDetails && (
        <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-8 shadow-xl max-w-md w-full border-t-4 border-indigo-500">
            <h2 className="text-3xl font-bold text-indigo-700 mb-4">Payment Summary</h2>
            <p className="text-lg text-gray-700 mb-2">User: <span className="font-semibold">{paymentDetails.username}</span></p>
            <p className="text-lg text-gray-700 mb-2">Total Duration: <span className="font-semibold">{paymentDetails.duration}</span></p>
            <p className="text-2xl font-extrabold text-green-600 mb-6">Total Payment: ₱{paymentDetails.totalPayment}</p>
            <button
              onClick={closePaymentModal}
              className="w-full bg-indigo-600 text-white p-3 rounded-lg hover:bg-indigo-700 transition duration-200 shadow-md text-lg font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Remove All Users */}
      {showConfirmRemoveAllModal && (
        <div className="fixed inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-8 shadow-xl max-w-md w-full border-t-4 border-red-500">
            <h2 className="text-2xl font-bold text-red-700 mb-4">Confirm Removal</h2>
            <p className="text-lg text-gray-700 mb-6">
              Are you sure you want to remove ALL users and clear all active sessions? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setShowConfirmRemoveAllModal(false)}
                className="px-6 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition duration-200"
              >
                Cancel
              </button>
              <button
                onClick={handleRemoveAllUsers}
                className="px-6 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition duration-200 shadow-md"
              >
                Confirm Remove All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
