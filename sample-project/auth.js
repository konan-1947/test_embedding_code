// sample-project/auth.js
/**
 * Checks if a user has admin privileges.
 * @param {object} user - The user object.
 * @returns {boolean} - True if the user is an admin.
 */
export function isAdmin(user) {
    return user && user.role === 'admin';
  }
  
  /**
   * Logs a user in by creating a session token.
   * @param {string} username - The user's username.
   * @param {string} password - The user's password.
   * @returns {string|null} - A session token or null if login fails.
   */
  export function loginUser(username, password) {
    if (username === 'test' && password === 'password') {
      return `token-${Date.now()}`;
    }
    return null;
  }