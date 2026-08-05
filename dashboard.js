document.addEventListener('alpine:init', () => {
    Alpine.data('dashboard', () => ({
        authenticated: false,
        password: '',
        loginError: '',
        currentTab: 'overview', // 'overview', 'orders', 'influencers'
        loading: false,
        
        // Analytics State
        liveUsers: 0,
        analyticsInterval: null,

        supabase: null,
        orders: [],
        influencerClicks: [],
        
        dateFilter: 'all', // 'all', 'today', 'week', 'month', 'custom'
        customStartDate: '',
        customEndDate: '',
        
        get filteredOrders() {
            if (this.dateFilter === 'all') return this.orders;
            
            const now = new Date();
            let start = new Date(0);
            let end = new Date();
            
            if (this.dateFilter === 'today') {
                start = new Date(now.setHours(0,0,0,0));
            } else if (this.dateFilter === 'week') {
                start = new Date(now.setDate(now.getDate() - 7));
            } else if (this.dateFilter === 'month') {
                start = new Date(now.getFullYear(), now.getMonth(), 1);
            } else if (this.dateFilter === 'custom') {
                if (!this.customStartDate) return this.orders; // fallback
                start = new Date(this.customStartDate);
                start.setHours(0,0,0,0);
                if (this.customEndDate) {
                    end = new Date(this.customEndDate);
                    end.setHours(23,59,59,999);
                }
            }
            
            return this.orders.filter(o => {
                const orderDate = new Date(o.created_at);
                return orderDate >= start && orderDate <= end;
            });
        },
        
        get activeOrders() {
            return this.filteredOrders.filter(o => o.status !== 'draft');
        },
        get abandonedCarts() {
            let drafts = this.filteredOrders.filter(o => o.status === 'draft');
            const activePhones = new Set(this.activeOrders.map(o => o.customer_phone ? o.customer_phone.replace(/\D/g, '') : ''));
            
            drafts = drafts.filter(o => {
                const phone = o.customer_phone ? o.customer_phone.replace(/\D/g, '') : '';
                return phone && !activePhones.has(phone);
            });
            
            const uniqueDrafts = {};
            for (const draft of drafts) {
                const phone = draft.customer_phone.replace(/\D/g, '');
                if (!uniqueDrafts[phone]) {
                    uniqueDrafts[phone] = draft; 
                }
            }
            return Object.values(uniqueDrafts);
        },
        get abandonedCount() {
            return this.abandonedCarts.length;
        },

        get influencerMetrics() {
            const metrics = { totalClicks: 0, totalSales: 0, list: [] };
            const map = {};

            // Helper to get date boundaries based on filter
            const getDateBoundaries = () => {
                if (this.dateFilter === 'all') return { start: new Date(0), end: new Date() };
                const now = new Date();
                let start = new Date(0);
                let end = new Date();
                if (this.dateFilter === 'today') start = new Date(now.setHours(0,0,0,0));
                else if (this.dateFilter === 'week') start = new Date(now.setDate(now.getDate() - 7));
                else if (this.dateFilter === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1);
                else if (this.dateFilter === 'custom' && this.customStartDate) {
                    start = new Date(this.customStartDate); start.setHours(0,0,0,0);
                    if (this.customEndDate) { end = new Date(this.customEndDate); end.setHours(23,59,59,999); }
                }
                return { start, end };
            };
            const { start, end } = getDateBoundaries();

            // Count Clicks (Filtered by Date)
            this.influencerClicks.forEach(click => {
                const clickDate = new Date(click.created_at);
                if (clickDate < start || clickDate > end) return;

                const utm = click.utm_source ? click.utm_source.toUpperCase().trim() : '';
                if (!utm) return;
                
                if (!map[utm]) map[utm] = { utm, clicks: 0, sales: 0 };
                map[utm].clicks++;
                metrics.totalClicks++;
            });

            // Count Sales (from orders with utm_source)
            this.activeOrders.forEach(order => {
                let utm = order.utm_source ? order.utm_source.toUpperCase().trim() : '';
                // Also check if coupon was used, treat as utm if utm_source is empty
                if (!utm && order.coupon) utm = order.coupon.toUpperCase().trim();
                
                if (!utm) return;

                if (!map[utm]) map[utm] = { utm, clicks: 0, sales: 0 };
                map[utm].sales++;
                metrics.totalSales++;
            });

            metrics.list = Object.values(map).sort((a, b) => b.sales - a.sales || b.clicks - a.clicks);
            return metrics;
        },
        
        get productSalesMetrics() {
            const metrics = {};
            const validStatuses = ['pending', 'approved', 'shipped', 'delivered'];
            const validOrders = this.activeOrders.filter(o => validStatuses.includes(o.status));

            validOrders.forEach(order => {
                if (order.items && Array.isArray(order.items)) {
                    order.items.forEach(item => {
                        const brand = item.brand || 'OUTROS';
                        const nameKey = item.name + (item.dos ? ' - ' + item.dos : '');
                        
                        if (!metrics[brand]) metrics[brand] = { totalRevenue: 0, totalItems: 0, products: {} };
                        if (!metrics[brand].products[nameKey]) {
                            metrics[brand].products[nameKey] = {
                                name: nameKey,
                                qty: 0,
                                revenue: 0,
                                brand: brand
                            };
                        }
                        
                        metrics[brand].products[nameKey].qty += parseInt(item.qty || 1);
                        metrics[brand].products[nameKey].revenue += (parseFloat(item.price) * parseInt(item.qty || 1));
                        
                        metrics[brand].totalItems += parseInt(item.qty || 1);
                        metrics[brand].totalRevenue += (parseFloat(item.price) * parseInt(item.qty || 1));
                    });
                }
            });
            
            return metrics;
        },
        
        get abandonedTotalValue() {
            return this.abandonedCarts.reduce((sum, order) => {
                return sum + (parseFloat(order.total) || 0);
            }, 0);
        },

        get topProductsList() {
            const allProducts = [];
            const metrics = this.productSalesMetrics;
            for (const brand in metrics) {
                for (const prodKey in metrics[brand].products) {
                    allProducts.push(metrics[brand].products[prodKey]);
                }
            }
            return allProducts.sort((a, b) => b.revenue - a.revenue).slice(0, 5);
        },

        get topStatesList() {
            const states = {};
            this.activeOrders.forEach(o => {
                const state = o.customer_state ? o.customer_state.toUpperCase().trim() : 'N/A';
                if (!states[state]) states[state] = { state, count: 0, revenue: 0 };
                states[state].count++;
                states[state].revenue += (parseFloat(o.total) || 0);
            });
            return Object.values(states).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
        },
        
        metrics: {
            revenue: 0,
            totalOrders: 0,
            ticketMedio: 0,
            topInfluencer: ''
        },
        
        influencers: {},
        newCoupon: { code: '', discount: '', type: 'percent', bundleQty: '', bundlePrice: '', brands: [] },
        savedCoupons: [],
        couponMetrics: {},
        
        init() {
            // Very basic hardcoded auth for demo/setup purposes (In production use actual Supabase Auth)
            if (localStorage.getItem('titan_admin_auth') === 'true') {
                this.authenticated = true;
                this.initSupabase();
            }
            
            this.$nextTick(() => {
                if (typeof lucide !== 'undefined') lucide.createIcons();
            });
        },
        
        login() {
            if (this.password === 'titan123') { // Simple admin password
                this.authenticated = true;
                this.loginError = '';
                localStorage.setItem('titan_admin_auth', 'true');
                this.initSupabase();
            } else {
                this.loginError = 'Senha incorreta. Acesso negado.';
            }
        },
        
        logout() {
            this.authenticated = false;
            localStorage.removeItem('titan_admin_auth');
            this.password = '';
        },
        
        initSupabase() {
            if (!this.supabase) {
                this.supabase = window.supabase.createClient('https://sclbrgfgxooqgqijuplq.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjbGJyZ2ZneG9vcWdxaWp1cGxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNDQ3MDUsImV4cCI6MjA5OTcyMDcwNX0.wq9KczbVz7Jp2TcD6CeKceSUmy5Rr7wuADk5MqIJvbs');
            }
            this.fetchData();
            this.startAnalyticsPolling();
        },

        startAnalyticsPolling() {
            this.fetchLiveUsers();
            this.analyticsInterval = setInterval(() => {
                this.fetchLiveUsers();
            }, 10000);
        },

        async fetchLiveUsers() {
            try {
                // Consider users active if they pinged in the last 15 seconds
                const fifteenSecondsAgo = new Date(Date.now() - 15000).toISOString();
                
                const { count, error } = await this.supabase
                    .from('site_visits')
                    .select('*', { count: 'exact', head: true })
                    .gte('last_ping_at', fifteenSecondsAgo);
                    
                if (!error && count !== null) {
                    this.liveUsers = count;
                }
            } catch (e) {
                console.error("Erro buscando radar ao vivo:", e);
            }
        },

        async fetchData() {
            if (this.loading) return;
            this.loading = true;
            
            try {
                // Fetch orders from Supabase
                const { data, error } = await this.supabase
                    .from('orders')
                    .select('*')
                    .order('created_at', { ascending: false });
                    
                if (error) throw error;
                this.orders = data || [];

                // Fetch influencer clicks
                try {
                    const { data: clicksData } = await this.supabase
                        .from('influencer_clicks')
                        .select('*');
                    if (clicksData) this.influencerClicks = clicksData;
                } catch(e) {
                    console.log('Error fetching clicks, table might not exist yet.');
                }
                this.calculateMetrics();
                
                this.$nextTick(() => {
                    this.renderChart();
                });
                
                // Watch for filter changes to re-render chart
                this.$watch('dateFilter', () => this.$nextTick(() => this.renderChart()));
                this.$watch('customStartDate', () => this.$nextTick(() => this.renderChart()));
                this.$watch('customEndDate', () => this.$nextTick(() => this.renderChart()));
                
            } catch (err) {
                console.error('Error fetching data:', err);
                alert('Erro ao buscar dados do servidor.');
            } finally {
                this.loading = false;
                
                // Load saved coupons
                try {
                    const { data: couponsData } = await this.supabase.from('coupons').select('*').order('code');
                    if (couponsData) {
                        this.savedCoupons = couponsData;
                        // Build coupon metrics from orders
                        this.couponMetrics = {};
                        this.activeOrders.forEach(o => {
                            const c = o.coupon ? o.coupon.toUpperCase().trim() : null;
                            if (c) {
                                if (!this.couponMetrics[c]) this.couponMetrics[c] = { count: 0, revenue: 0 };
                                this.couponMetrics[c].count++;
                                this.couponMetrics[c].revenue += parseFloat(o.total) || 0;
                            }
                        });
                    }
                } catch(e) { console.error('Coupons fetch error:', e); }
                
                this.$nextTick(() => {
                    if (typeof lucide !== 'undefined') lucide.createIcons();
                });
            }
        },
        
        calculateMetrics() {
            let totalRevenue = 0;
            let infTracker = {};
            
            this.activeOrders.forEach(order => {
                const value = parseFloat(order.total) || 0;
                totalRevenue += value;
                
                // Track influencers by coupon
                const coupon = order.coupon ? order.coupon.toUpperCase().trim() : null;
                if (coupon) {
                    if (!infTracker[coupon]) {
                        infTracker[coupon] = { count: 0, revenue: 0 };
                    }
                    infTracker[coupon].count += 1;
                    infTracker[coupon].revenue += value;
                }
            });
            
            this.metrics.revenue = totalRevenue;
            this.metrics.totalOrders = this.activeOrders.length;
            this.metrics.ticketMedio = this.activeOrders.length > 0 ? (totalRevenue / this.activeOrders.length) : 0;
            
            // Find top influencer
            let topCode = '';
            let maxRevenue = 0;
            Object.keys(infTracker).forEach(code => {
                if (infTracker[code].revenue > maxRevenue) {
                    maxRevenue = infTracker[code].revenue;
                    topCode = code;
                }
            });
            
            this.metrics.topInfluencer = topCode || 'Nenhum';
            this.influencers = infTracker;
        },
        
        renderChart() {
            const ctx = document.getElementById('salesChart');
            if (!ctx) return;
            
            const last7Days = {};
            for(let i=6; i>=0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                last7Days[d.toLocaleDateString('pt-BR')] = 0;
            }
            
            this.activeOrders.forEach(o => {
                const d = new Date(o.created_at).toLocaleDateString('pt-BR');
                if(last7Days[d] !== undefined) {
                    last7Days[d] += parseFloat(o.total) || 0;
                }
            });
            
            const labels = Object.keys(last7Days);
            const data = Object.values(last7Days);
            
            if(window.salesChartInstance) window.salesChartInstance.destroy();
            
            window.salesChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Faturamento (R$)',
                        data: data,
                        borderColor: '#dc2626',
                        backgroundColor: 'rgba(220, 38, 38, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                        x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
                    }
                }
            });
        },
        
        async updateOrderStatus(id, status) {
            try {
                const { error } = await this.supabase.from('orders').update({ status }).eq('id', id);
                if(error) throw error;
            } catch(e) {
                console.error(e);
                alert("Erro ao atualizar status");
            }
        },
        
        async saveTrackingCode(id, code) {
            try {
                const { error } = await this.supabase.from('orders').update({ tracking_code: code }).eq('id', id);
                if(error) throw error;
                alert("Código de rastreio salvo!");
            } catch(e) {
                console.error(e);
                alert("Erro ao salvar rastreador");
            }
        },
        
        async createCoupon() {
            if(!this.newCoupon.code) return alert('Preencha o código do cupom');
            if(this.newCoupon.type === 'percent' && !this.newCoupon.discount) return alert('Preencha o desconto %');
            if(this.newCoupon.type === 'bundle' && (!this.newCoupon.bundleQty || !this.newCoupon.bundlePrice)) return alert('Preencha a quantidade e o preço do combo');
            
            try {
                const payload = {
                    code: this.newCoupon.code.toUpperCase().trim(),
                    type: this.newCoupon.type,
                    discount_percent: this.newCoupon.type === 'percent' ? parseFloat(this.newCoupon.discount) : null,
                    bundle_qty: this.newCoupon.type === 'bundle' ? parseInt(this.newCoupon.bundleQty) : null,
                    bundle_price: this.newCoupon.type === 'bundle' ? parseFloat(this.newCoupon.bundlePrice) : null,
                    brands: this.newCoupon.brands.length > 0 ? this.newCoupon.brands : null
                };
                
                const { error } = await this.supabase.from('coupons').insert([payload]);
                
                if(error) {
                    if(error.code === '23505') throw new Error('Este cupom já existe.');
                    throw error;
                }
                
                alert('Cupom criado com sucesso!');
                this.savedCoupons.push(payload);
                this.newCoupon = { code: '', discount: '', type: 'percent', bundleQty: '', bundlePrice: '', brands: [] };
            } catch(e) {
                console.error(e);
                alert(e.message || 'Erro ao criar cupom.');
            }
        },
        
        toggleBrand(brand) {
            const idx = this.newCoupon.brands.indexOf(brand);
            if (idx > -1) {
                this.newCoupon.brands.splice(idx, 1);
            } else {
                this.newCoupon.brands.push(brand);
            }
        },
        
        recoverCart(order) {
            const phone = order.customer_phone.replace(/\D/g, '');
            const firstName = order.customer_name ? order.customer_name.split(' ')[0] : 'Cliente';
            
            const message = `Oi ${firstName}! Tudo bem? 🚀\n\nVi que você deixou alguns itens no carrinho da *TITAN* e não finalizou sua compra.\n\nFicou com alguma dúvida sobre os produtos ou frete? Posso te ajudar a concluir seu pedido?`;
            
            const url = `https://wa.me/55${phone}?text=${encodeURIComponent(message)}`;
            window.open(url, '_blank');
        },
        
        formatDateTime(dateString) {
            if(!dateString) return '-';
            const d = new Date(dateString);
            return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
        },
        
        groupByBrand(items) {
            if (!items || !Array.isArray(items)) return {};
            return items.reduce((acc, item) => {
                const brand = item.brand || 'OUTROS';
                if (!acc[brand]) acc[brand] = [];
                acc[brand].push(item);
                return acc;
            }, {});
        },
        
        formatDate(dateString) {
            if (!dateString) return '-';
            const date = new Date(dateString);
            return new Intl.DateTimeFormat('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            }).format(date);
        }
    }));
});
